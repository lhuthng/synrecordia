import fs from "fs";
import path from "path";

const src = "src/assets/samples/piano";
const destBase = "public/samples/piano";

const files = fs.readdirSync(src);

for (let v = 1; v <= 16; v += 1) {
  const dest = path.join(destBase, `v${v}`);
  fs.mkdirSync(dest, { recursive: true });

  const pattern = new RegExp(`^[A-G]#?\\d+v${v}\\.wav$`);
  const picked = files.filter((file) => pattern.test(file));
  const renamed = [];

  for (const file of picked) {
    const target = file.replace("#", "s");
    fs.copyFileSync(path.join(src, file), path.join(dest, target));
    renamed.push(target);
  }

  fs.writeFileSync(
    path.join(dest, "index.json"),
    JSON.stringify(renamed.sort(), null, 2),
  );
  console.log(`v${v}: ${renamed.length} samples`);
}
