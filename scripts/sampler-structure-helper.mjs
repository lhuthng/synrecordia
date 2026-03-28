import fs from "fs";
import path from "path";

const targetDir = process.argv[2];

if (!targetDir) {
  console.error("Usage: node transform.js <path-to-parent-folder>");
  process.exit(1);
}

const fullPath = path.resolve(targetDir);

if (!fs.existsSync(fullPath)) {
  console.error(`Error: Directory not found at ${fullPath}`);
  process.exit(1);
}

/**
 * Searches for a note pattern like A4, Gs6, or Db3 within the filename
 */
function transformData(arr) {
  const result = {};

  arr.forEach((filename) => {
    // Regex breakdown:
    // ([A-G])    -> Group 1: The Note letter
    // (s|b|#)?   -> Group 2: Optional sharp (s/#) or flat (b)
    // (\d)       -> Group 3: The Octave number
    const match = filename.match(/([A-G])(s|b|#)?(\d)/i);

    if (match) {
      const note = match[1].toUpperCase();
      let accidental = match[2] ? match[2].toLowerCase() : "";
      const octave = match[3];

      // Standardize 's' to '#' for Tone.js
      if (accidental === "s") accidental = "#";

      const key = `${note}${accidental}${octave}`;
      result[key] = filename;
    }
  });

  return result;
}

function processDirectories(dir) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (file !== "node_modules" && file !== ".git") {
        processDirectories(filePath);
      }
    } else if (file === "index.json") {
      try {
        const rawData = fs.readFileSync(filePath, "utf8");
        const json = JSON.parse(rawData);

        if (Array.isArray(json)) {
          const newData = transformData(json);
          fs.writeFileSync(filePath, JSON.stringify(newData, null, 2));
          console.log(`✅ Transformed: ${filePath}`);
        }
      } catch (err) {
        console.error(`❌ Error in ${filePath}:`, err.message);
      }
    }
  });
}

console.log(`🚀 Scanning for Tone.js compatibility: ${fullPath}...`);
processDirectories(fullPath);
console.log("✨ Done!");
