// Prints how varied the generated songs are (src/variety.ts), per genre and chords mode.
// Usage: pnpm variety [songs per genre, default 400] [genre…]
import { createServer } from "vite";

const args = process.argv.slice(2);
const songs = Number(args.find((a) => /^\d+$/.test(a)) ?? 400);
const genres = args.filter((a) => !/^\d+$/.test(a));

const server = await createServer({
  server: { middlewareMode: true, hmr: false },
  appType: "custom",
  logLevel: "error",
});
try {
  const { measureVariety, varietyReport } = await server.ssrLoadModule("/src/variety.ts");
  const { GENRE_IDS } = await server.ssrLoadModule("/src/genres.ts");
  for (const genre of genres.length ? genres : GENRE_IDS)
    for (const chords of ["classic", "theory"])
      console.log(`${varietyReport(measureVariety(genre, chords, songs))}\n`);
} finally {
  await server.close();
}
