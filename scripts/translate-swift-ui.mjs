import fs from "fs";
import path from "path";

const APPS_DIR = path.join(process.cwd(), "apps");
// We want to skip testing files and non-SwiftUI core to reduce noise
const IGNORE_DIRS = ["tests", "test", "checkouts", "build", ".build", "macOS/Tests", "iOS/Tests"];

// Simple regex heuristics for SwiftUI strings
const STRING_PATTERNS = [
  /Text\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g,
  /Button\(\s*"((?:[^"\\]|\\.)*)"/g,
  /Label\(\s*"((?:[^"\\]|\\.)*)"/g,
  /Menu\(\s*"((?:[^"\\]|\\.)*)"/g,
  /Picker\(\s*"((?:[^"\\]|\\.)*)"/g,
  /Toggle\(\s*"((?:[^"\\]|\\.)*)"/g,
  /NavigationLink\(\s*"((?:[^"\\]|\\.)*)"/g,
  /Text\(\s*String\(localized:\s*"((?:[^"\\]|\\.)*)"\s*\)\s*\)/g,
];

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

function extractStrings() {
  const dictionary = new Set();
  let fileCount = 0;

  walkDir(APPS_DIR, (filepath) => {
    fileCount++;
    const content = fs.readFileSync(filepath, "utf8");

    for (const pattern of STRING_PATTERNS) {
      let match;
      while ((match = pattern.exec(content)) !== null) {
        let str = match[1];
        // filter out pure variables or empty strings
        if (str && str.trim() !== "" && !str.startsWith("\\(")) {
          // also filter out non-alpha if it's strictly punctuation
          if (/[a-zA-Z]/.test(str)) {
            dictionary.add(str);
          }
        }
      }
    }
  });

  const sortedArray = Array.from(dictionary).toSorted((a, b) => a[0].localeCompare(b[0]));
  console.log(`Scanned ${fileCount} swift files.`);
  console.log(`Found ${sortedArray.length} unique UI strings.`);

  const dictObj = {};
  for (const str of sortedArray) {
    dictObj[str] = "";
  }

  fs.writeFileSync("scripts/swift-translations.json", JSON.stringify(dictObj, null, 2));
  console.log("Wrote to scripts/swift-translations.json");
}

extractStrings();
