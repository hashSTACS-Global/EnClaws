import fs from "fs";
import path from "path";

const APPS_DIR = path.join(process.cwd(), "apps");
const IGNORE_DIRS = ["tests", "test", "checkouts", "build", ".build"];

const dictPath = path.join(process.cwd(), "scripts", "swift-translations.json");
const DICT = JSON.parse(fs.readFileSync(dictPath, "utf8"));

function walkDir(dir, callback) {
  if (!fs.existsSync(dir)) {
    return;
  }
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (IGNORE_DIRS.some((ignored) => dir.toLowerCase().includes(ignored))) {
      continue;
    }

    const filepath = path.join(dir, file);
    const stat = fs.statSync(filepath);
    if (stat.isDirectory()) {
      walkDir(filepath, callback);
    } else if (file.endsWith(".swift")) {
      callback(filepath);
    }
  }
}

let modifiedFilesCount = 0;

walkDir(APPS_DIR, (filepath) => {
  let content = fs.readFileSync(filepath, "utf8");
  let originalContent = content;

  // We wrap replace calls to only match exact components
  for (const [en, zh] of Object.entries(DICT)) {
    // Escape regex chars in English string
    const safeEn = en.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");

    const zhStr = String(zh);

    // Replace Text("EN") -> Text("ZH")
    content = content.replace(new RegExp(`Text\\(\\s*"${safeEn}"\\s*\\)`, "g"), `Text("${zhStr}")`);
    // Replace Button("EN")
    content = content.replace(new RegExp(`Button\\(\\s*"${safeEn}"`, "g"), `Button("${zhStr}"`);
    // Replace Label("EN"
    content = content.replace(new RegExp(`Label\\(\\s*"${safeEn}"`, "g"), `Label("${zhStr}"`);
    // Replace Menu("EN")
    content = content.replace(new RegExp(`Menu\\(\\s*"${safeEn}"\\s*\\)`, "g"), `Menu("${zhStr}")`);
    // Replace Menu("EN" {
    content = content.replace(new RegExp(`Menu\\(\\s*"${safeEn}"`, "g"), `Menu("${zhStr}"`);
    // Replace Picker("EN"
    content = content.replace(new RegExp(`Picker\\(\\s*"${safeEn}"`, "g"), `Picker("${zhStr}"`);
    // Replace Toggle("EN"
    content = content.replace(new RegExp(`Toggle\\(\\s*"${safeEn}"`, "g"), `Toggle("${zhStr}"`);
  }

  if (content !== originalContent) {
    fs.writeFileSync(filepath, content, "utf8");
    modifiedFilesCount++;
  }
});

console.log(`Translation applied. Modified ${modifiedFilesCount} files.`);
