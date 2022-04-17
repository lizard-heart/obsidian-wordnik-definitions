import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  Editor,
  MarkdownView,
  TextComponent,
  RequestParam,
  request,
} from "obsidian";

interface WordnikExtract {
  title: string;
  text: string[];
  url: string;
}


interface WordnikPluginSettings {
  template: string;
  apiKey: string;
  maxDefinitions: number;
}

const DEFAULT_SETTINGS: WordnikPluginSettings = {
  template: `## {{searchTerm}}\n{{text}}\n{{relatedWords}}\n> [Additional info]({{url}})`,
  apiKey: "",
  maxDefinitions: 5,
};

export default class WordnikPlugin extends Plugin {
  settings: WordnikPluginSettings;


  getApiUrl(title: string): string {
    return "https://api.wordnik.com/v4/word.json/" + encodeURIComponent(title) + "/definitions?limit=200&includeRelated=false&useCanonical=false&includeTags=false&api_key=" + this.settings.apiKey;
  }

  getRelatedApiUrl(title: string): string {
    return "https://api.wordnik.com/v4/word.json/" + encodeURIComponent(title) + "/relatedWords?useCanonical=false&limitPerRelationshipType=10&api_key=" + this.settings.apiKey;
  }


  formatExtractText(extract: WordnikExtract, searchTerm: string): string {
    var textToReturn = ""
    for (var i = 0; i < extract.text.length; i++) {
      if (i < this.settings.maxDefinitions) {
        textToReturn += extract.text[i] + "\n"
      }

    }
    return textToReturn;
  }

  formatRelatedWordsText(extract: WordnikExtract, searchTerm: string): string {
    var textToReturn = ""
    for (var i = 0; i < extract.text.length; i++) {
      textToReturn += extract.text[i] + "\n"
    }
    return textToReturn;
  }

  handleNotFound(searchTerm: string) {
    new Notice(`${searchTerm} not found in the wordnik database.`);
  }


  parseResponse(json: any): WordnikExtract | undefined {
    const definitions = []
    for (let i = 0; i < Number(json["length"]); i++) {
      definitions.push("*" + json[i]["partOfSpeech"] + "*: " + json[i]["text"])
    }
    const extract: WordnikExtract = {
      title: "word",
      text: definitions,
      url: json[0]["wordnikUrl"]
    }
    console.log("definitions extract: ");
    console.log(extract);
    return extract
  }

  parseRelatedResponse(json: any): WordnikExtract | undefined {
    const lines : string[] = [];
    var typesOfRelation = "| ";
    var dashes = "|";
    var allRelatedWords: Array<Array<string>> = [[],[],[],[],[],[],[],[],[],[]];
    var relatedWordsLengths : Array<number> = []
    for (let i = 0; i < json["length"]; i++) {
      typesOfRelation += json[i]["relationshipType"] + " |";
      dashes += " --- |";
      relatedWordsLengths.push(json[i]["words"].length)
    }
    for (let i = 0; i < Math.max(...relatedWordsLengths); i++) {
      for (let j = 0; j < json["length"]; j++) {
        if (json[j]["words"][i] != undefined) {
          allRelatedWords[i].push(json[j]["words"][i])
        } else {
          allRelatedWords[i].push("")
        }
      }
    }
    
    lines.push(typesOfRelation);
    lines.push(dashes);
    for (let i = 0; i < allRelatedWords.length; i++) {
      lines.push("| " + allRelatedWords[i].join(" | ") + " |");
    }
    const extract: WordnikExtract = {
      title: "word",
      text: lines,
      url: ""
    }
    console.log("related extract: ");
    console.log(extract);
    return extract
  }

  formatExtractInsert(extract: WordnikExtract, relatedExtract: WordnikExtract, searchTerm: string): string {
    const formattedText = this.formatExtractText(extract, searchTerm);
    const relatedWordsText = this.formatRelatedWordsText(relatedExtract, searchTerm);
    const template = this.settings.template;
    const formattedTemplate = template
      .replace("{{text}}", formattedText)
      .replace("{{relatedWords}}", relatedWordsText)
      .replace("{{searchTerm}}", searchTerm)
      .replace("{{url}}", extract.url);
    return formattedTemplate;
  }

  async getWordnikText(title: string): Promise<WordnikExtract | undefined> {
    const url = this.getApiUrl(title);
    console.log("definitions url: ")
    console.log(url)
    const requestParam: RequestParam = {
      url: url,
    };
    const resp = await request(requestParam)
      .then((r) => JSON.parse(r))
      .catch(
        () =>
          new Notice(
            "Failed to get Wordnik data. Check your internet connection."
          )
      );
    console.log("definitions resp: ");
    console.log(resp);
    const extract = this.parseResponse(resp);
    return extract;
  }

  async getRelatedWords(title: string): Promise<WordnikExtract | undefined> {
    const url = this.getRelatedApiUrl(title);
    console.log("related url: ");
    console.log(url);
    const requestParam: RequestParam = {
      url: url,
    };
    const resp = await request(requestParam)
      .then((r) => JSON.parse(r))
      .catch(
        () =>
          new Notice(
            "Failed to get Wordnik data. Check your internet connection."
          )
      );
    console.log("related resp: ");
    console.log(resp);
    const extract = this.parseRelatedResponse(resp);
    return extract;
  }

  async pasteIntoEditor(editor: Editor, searchTerm: string) {
    let extract: WordnikExtract = await this.getWordnikText(searchTerm);
    let relatedExtract: WordnikExtract = await this.getRelatedWords(searchTerm);
    console.log("FROM PASTE INTO EDITOR");
    console.log(extract.text);
    console.log(relatedExtract.text);
    if (!extract) {
      this.handleNotFound(searchTerm);
      return;
    }
    editor.replaceSelection(this.formatExtractInsert(extract, relatedExtract, searchTerm));
  }

  async getWordnikTextForActiveFile(editor: Editor) {
    const activeFile = await this.app.workspace.getActiveFile();
    if (activeFile) {
      const searchTerm = activeFile.basename;
      if (searchTerm) {
        await this.pasteIntoEditor(editor, searchTerm);
      }
    }
  }

  async getWordnikTextForSearchTerm(editor: Editor) {
    new WikipediaSearchModal(this.app, this, editor).open();
  }

  async onload() {
    await this.loadSettings();

    this.addCommand({
      id: "wordnik-get-active-note-title",
      name: "Get Wordik data for Active Note Title",
      editorCallback: (editor: Editor) =>
        this.getWordnikTextForActiveFile(editor),
    });

    this.addCommand({
      id: "wordnik-get-search-term",
      name: "Get Wordnik data for Search Term",
      editorCallback: (editor: Editor) =>
        this.getWordnikTextForSearchTerm(editor),
    });

    this.addSettingTab(new WikipediaSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }
}

class WikipediaSearchModal extends Modal {
  searchTerm: string;
  plugin: WordnikPlugin;
  editor: Editor;

  constructor(app: App, plugin: WordnikPlugin, editor: Editor) {
    super(app);
    this.plugin = plugin;
    this.editor = editor;
  }

  onOpen() {
    let { contentEl } = this;

    contentEl.createEl("h2", { text: "Enter Search Term:" });

    const inputs = contentEl.createDiv("inputs");
    const searchInput = new TextComponent(inputs).onChange((searchTerm) => {
      this.searchTerm = searchTerm;
    });
    searchInput.inputEl.focus();
    searchInput.inputEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        this.close();
      }
    });

    const controls = contentEl.createDiv("controls");
    const searchButton = controls.createEl("button", {
      text: "Search",
      cls: "mod-cta",
      attr: {
        autofocus: true,
      },
    });
    searchButton.addEventListener("click", this.close.bind(this));
    const cancelButton = controls.createEl("button", { text: "Cancel" });
    cancelButton.addEventListener("click", this.close.bind(this));
  }

  async onClose() {
    let { contentEl } = this;

    contentEl.empty();
    if (this.searchTerm) {
      await this.plugin.pasteIntoEditor(this.editor, this.searchTerm);
    }
  }
}

class WikipediaSettingTab extends PluginSettingTab {
  plugin: WordnikPlugin;

  constructor(app: App, plugin: WordnikPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Obsidian Wordnik" });

    new Setting(containerEl)
      .setName("Wordnik Extract Template")
      .setDesc(
        `Set markdown template for extract to be inserted.\n
        Available template variables are {{text}}, {{searchTerm}}, {{relatedWords}} and {{url}}.
        `
      )
      .addTextArea((textarea) =>
        textarea
          .setValue(this.plugin.settings.template)
          .onChange(async (value) => {
            this.plugin.settings.template = value;
            await this.plugin.saveSettings();
          })
      );


    new Setting(containerEl)
      .setName("Wordnik API Key")
      .setDesc(
        "You will need to include your Wordnik API key to use this plugin."
      )
      .addText((textField) => {
        textField
          .setValue(this.plugin.settings.apiKey)
          .onChange(async (value) => {
            this.plugin.settings.apiKey = value;
            await this.plugin.saveSettings();
          });
      });
    
    new Setting(containerEl)
      .setName("Maximum Definitions")
      .setDesc(
        "The most definitions from wordnik that will be shown in the result."
      )
      .addText((textField) => {
        textField
          .setValue(String(this.plugin.settings.maxDefinitions))
          .onChange(async (value) => {
            this.plugin.settings.maxDefinitions = Number(value);
            await this.plugin.saveSettings();
          });
      });
  }
}
