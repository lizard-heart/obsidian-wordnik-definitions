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
  shouldUseParagraphTemplate: boolean;
  shouldBoldSearchTerm: boolean;
  apiKey: string;
  paragraphTemplate: string;
  language: string;
  maxDefinitions: number;
}

const DEFAULT_SETTINGS: WordnikPluginSettings = {
  template: `## {{searchTerm}}\n {{text}}\n> [Additional info]({{url}})`,
  shouldUseParagraphTemplate: true,
  shouldBoldSearchTerm: true,
  paragraphTemplate: `> {{paragraphText}}\n>\n`,
  language: "en",
  apiKey: "",
  maxDefinitions: 5,
};

const disambiguationIdentifier = "may refer to:";
export default class WordnikPlugin extends Plugin {
  settings: WordnikPluginSettings;


  getApiUrl(title: string): string {
    return "https://api.wordnik.com/v4/word.json/" + encodeURIComponent(title) + "/definitions?limit=200&includeRelated=false&useCanonical=false&includeTags=false&api_key=" + this.settings.apiKey;
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

  handleNotFound(searchTerm: string) {
    new Notice(`${searchTerm} not found in the wordnik database.`);
  }

  handleCouldntResolveDisambiguation() {
    new Notice(`Could not automatically resolve disambiguation.`);
  }

  hasDisambiguation(extract: WordnikExtract) {
    // if (extract.text.includes(disambiguationIdentifier)) {
    //   return true;
    // }
    return false;
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
    console.log(extract)
    return extract
  }

  formatExtractInsert(extract: WordnikExtract, searchTerm: string): string {
    const formattedText = this.formatExtractText(extract, searchTerm);
    const template = this.settings.template;
    const formattedTemplate = template
      .replace("{{text}}", formattedText)
      .replace("{{searchTerm}}", searchTerm)
      .replace("{{url}}", extract.url);
    return formattedTemplate;
  }

  async getWordnikText(title: string): Promise<WordnikExtract | undefined> {
    const url = this.getApiUrl(title);
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
    console.log(resp)
    const extract = this.parseResponse(resp);
    return extract;
  }

  async pasteIntoEditor(editor: Editor, searchTerm: string) {
    let extract: WordnikExtract = await this.getWordnikText(searchTerm);
    if (!extract) {
      this.handleNotFound(searchTerm);
      return;
    }
    editor.replaceSelection(this.formatExtractInsert(extract, searchTerm));
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
      .setName("Wordnik Language Prefix")
      .setDesc(`Choose Wordnik language prefix to use (ex. en for English)`)
      .addText((textField) => {
        textField
          .setValue(this.plugin.settings.language)
          .onChange(async (value) => {
            this.plugin.settings.language = value;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Wordnik Extract Template")
      .setDesc(
        `Set markdown template for extract to be inserted.\n
        Available template variables are {{text}}, {{searchTerm}} and {{url}}.
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

    new Setting(containerEl)
      .setName("Bold Search Term?")
      .setDesc(
        "If set to true, the first instance of the search term will be **bolded**"
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.shouldBoldSearchTerm)
          .onChange(async (value) => {
            this.plugin.settings.shouldBoldSearchTerm = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Use paragraph template?")
      .setDesc(
        "If set to true, the paragraph template will be inserted for each paragraph of text for {{text}} in main template."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.shouldUseParagraphTemplate)
          .onChange(async (value) => {
            this.plugin.settings.shouldUseParagraphTemplate = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Paragraph Template")
      .setDesc(
        `Set markdown template for extract paragraphs to be inserted.\n
        Available template variables are: {{paragraphText}}
        `
      )
      .addTextArea((textarea) =>
        textarea
          .setValue(this.plugin.settings.paragraphTemplate)
          .onChange(async (value) => {
            this.plugin.settings.paragraphTemplate = value;
            await this.plugin.saveSettings();
          })
      );
  }
}
