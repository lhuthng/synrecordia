import Directory from "./Directory";
import me from "../assets/me.svg";

export default function Details() {
  return (
    <div className="space-y-4 pb-8 max-w-4xl mx-auto px-4">
      <img
        className="mx-auto rounded-full bg-main w-40 h-40"
        src={me}
        alt="Developer Avatar"
      />
      <hr className="bg-white h-1 rounded-full opacity-20" />

      <section className="text-white">
        <div className="[&>h2]:text-4xl [&>h3]:text-2xl space-y-4">
          <h2 className="text-center mb-6">About SynRecordia</h2>

          <p>
            I built SynRecordia as an experiment in bringing high-performance
            music visualization to the browser. Inspired by tools like{" "}
            <a
              className="underline text-note-full"
              href="https://synthesiagame.com/"
              target="_blank"
              rel="noreferrer"
            >
              Synthesia
            </a>
            , the goal was to create a lightweight, web-first platform where
            users can see fingering and note labels in real-time alongside
            high-quality sampled audio.
          </p>

          <h3>The Origin</h3>
          <p>
            This is a modern evolution of my previous project,
            <a
              className="underline text-note-full ml-1"
              href="https://github.com/lhuthng/RecorderVisualization"
              target="_blank"
              rel="noreferrer"
            >
              RecorderVisualization
            </a>
            . While the original was built in GameMaker Studio 2, I migrated to
            a web-first stack to achieve better precision, performance, and
            accessibility.
          </p>

          <h3>The Tech</h3>
          <p>
            The app leverages PIXI.js for WebGL-accelerated visuals and Tone.js
            for sample-accurate audio scheduling. The interface is managed by
            React to keep state and configuration seamless.
          </p>

          <h3>Work in Progress</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong>Practice Mode:</strong> Real-time note detection and
              performance feedback.
            </li>
            <li>
              <strong>Song Library:</strong> Expanding the collection with more
              simplified arrangements for beginners.
            </li>
          </ul>

          <h3>Known Issues</h3>
          <ul className="list-disc list-inside text-sm opacity-80 space-y-1">
            <li>
              Current mobile performance may experience latency. I am working on
              optimizing the synchronization between the Tone.js audio timeline
              and the PIXI.js render loop.
            </li>
            <li>
              Some songs currently contain notes that are out of range for the
              selected instrument's sample set.
            </li>
          </ul>

          <h3>Me and Source</h3>
          <p>
            I'm a developer who enjoys exploring the intersection of frontend
            engineering and creative tools. SynRecordia is a personal challenge
            for me to learn more about web audio and high-performance rendering.
            This project is fully open-source, and I welcome any
            contributions-especially from those with more experience in audio
            engineering or canvas optimization.
          </p>

          <ul className="flex flex-wrap gap-4 pt-4 [&>li>a]:text-note-full [&>li>a]:underline [&>li>a]:font-medium">
            <li>
              <a
                href="https://github.com/lhuthng/synrecordia"
                target="_blank"
                rel="noreferrer"
              >
                GitHub Repository
              </a>
            </li>
            <li>
              <a href="mailto:huuthang.l@outlook.com">Contact</a>
            </li>
            <li>
              <a
                href="https://blog.huuthangle.site"
                target="_blank"
                rel="noreferrer"
              >
                Blog
              </a>
            </li>
          </ul>

          <h3 className="pt-6">FAQ</h3>
          <div className="space-y-3">
            <div className="bg-card-bg p-3 rounded-lg">
              <h4 className="font-semibold">1. How to open a song?</h4>
              <div className="flex flex-wrap items-center mt-2 gap-2">
                <p>
                  Click the button on the top-left of the site, or open the
                  directory here:
                </p>
                <Directory
                  onSelected={() => {
                    document.body.scrollTop = 0;
                    document.documentElement.scrollTop = 0;
                  }}
                />
              </div>
            </div>

            <div className="bg-card-bg p-3 rounded-lg">
              <h4 className="font-semibold">2. How to open my own song?</h4>
              <p className="mt-2">
                You can not, for now. I am working on parsing user-provided
                songs (MIDI/audio), with MIDI parsing prioritized. Stay tuned.
              </p>
            </div>

            <div className="bg-card-bg p-3 rounded-lg">
              <h4 className="font-semibold">3. Why is it so laggy?</h4>
              <p className="mt-2">
                I'm working on optimizations. For now the biggest cause is a
                very narrow note width - try increasing the note width so fewer
                notes are rendered on screen at once.
              </p>
            </div>

            <div className="bg-card-bg p-3 rounded-lg">
              <h4 className="font-semibold">
                4. How can I report a bug or request a feature?
              </h4>
              <p className="mt-2">
                I welcome bug reports and feature requests. Open an issue on the
                GitHub repo{" "}
                <a
                  className="underline text-note-full"
                  href="https://github.com/lhuthng/synrecordia"
                  target="_blank"
                  rel="noreferrer"
                >
                  https://github.com/lhuthng/synrecordia
                </a>
                , email{" "}
                <a
                  className="underline text-note-full"
                  href="mailto:huuthang.l@outlook.com"
                >
                  huuthang.l@outlook.com
                </a>
                , or DM me on LinkedIn if you prefer. Please include your
                browser/OS, steps to reproduce, and any console errors.
              </p>
            </div>

            <div className="bg-card-bg p-3 rounded-lg">
              <h4 className="font-semibold">
                5. Why am I missing some fingering patterns?
              </h4>
              <p className="mt-2">
                Some notes have multiple fingering options. I’m working on tools
                to pick or let you set the fingering directly (or choose an
                algorithm that minimizes finger strain). This is a planned
                improvement - stay tuned.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
