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
            SynRecordia started as a personal experiment - I wanted to see how
            far I could push music visualization in the browser. Inspired by{" "}
            <a
              className="underline text-note-full"
              href="https://synthesiagame.com/"
              target="_blank"
              rel="noreferrer"
            >
              Synthesia
            </a>
            , I built a lightweight web app where you can watch fingering and
            note labels update in real time as the song plays.
          </p>

          <h3>Where it came from</h3>
          <p>
            This is a rewrite of an older project of mine,{" "}
            <a
              className="underline text-note-full ml-1"
              href="https://github.com/lhuthng/RecorderVisualization"
              target="_blank"
              rel="noreferrer"
            >
              RecorderVisualization
            </a>
            , which I originally built in GameMaker Studio 2. Moving it to the
            web gave me much better control over precision, performance, and who
            can actually use it.
          </p>

          <h3>The stack</h3>
          <p>
            The visualizer runs on PIXI.js for WebGL rendering and Tone.js for
            sample-accurate audio. React handles all the state and UI logic on
            top.
          </p>

          <h3>Still in progress</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong>Practice Mode:</strong> Real-time note detection so you
              can play along and get feedback.
            </li>
            <li>
              <strong>Song Library:</strong> More songs, especially
              beginner-friendly arrangements.
            </li>
          </ul>

          <h3>Known issues</h3>
          <ul className="list-disc list-inside text-sm opacity-80 space-y-1">
            <li>
              Mobile performance can be sluggish - the Tone.js audio timeline
              and the PIXI.js render loop don't always sync up perfectly on
              lower-end devices. It's something I'm actively looking into.
            </li>
            <li>
              A few songs have notes that fall outside the sample range, so they
              may sound off or silent.
            </li>
          </ul>

          <h3>About me & source</h3>
          <p>
            I'm a developer who likes building things at the intersection of
            frontend engineering and creative tools. SynRecordia is how I've
            been learning web audio and high-performance canvas rendering - and
            it's fully open source. If you want to contribute, especially around
            audio or rendering, I'd love that.
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
              <h4 className="font-semibold">1. How do I open a song?</h4>
              <div className="flex flex-wrap items-center mt-2 gap-2">
                <p>
                  Hit the folder button in the top-left, or open the directory
                  right here:
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
              <h4 className="font-semibold">2. Can I load my own songs?</h4>
              <p className="mt-2">
                Not yet, but it's on the list. MIDI import is the priority -
                stay tuned.
              </p>
            </div>

            <div className="bg-card-bg p-3 rounded-lg">
              <h4 className="font-semibold">
                3. What am I actually looking at?
              </h4>
              <p className="mt-2">
                The visualizer shows which recorder holes are being pressed for
                each note. The holes are split into three groups:
              </p>
              <ul className="list-disc list-inside mt-2">
                <li>Group 1: the left-thumb hole (the back hole).</li>
                <li>
                  Group 2: three holes for the left hand - index, middle, and
                  ring fingers.
                </li>
                <li>
                  Group 3: four holes for the right hand - index, middle, ring,
                  and pinky fingers.
                </li>
              </ul>
              <p className="mt-2">
                There's also a "?" button in the UI that overlays a diagram of
                the actual instrument so you can see how the holes map to the
                real thing.
              </p>
            </div>

            <div className="bg-card-bg p-3 rounded-lg">
              <h4 className="font-semibold">4. Why is it lagging?</h4>
              <p className="mt-2">
                The most common cause is a very small note width - when the
                notes are tiny, a lot more of them are on screen at once. Try
                increasing the note width in the settings.
              </p>
            </div>

            <div className="bg-card-bg p-3 rounded-lg">
              <h4 className="font-semibold">
                5. Found a bug or have a feature idea?
              </h4>
              <p className="mt-2">
                Open an issue on{" "}
                <a
                  className="underline text-note-full"
                  href="https://github.com/lhuthng/synrecordia"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>{" "}
                or shoot me an email at{" "}
                <a
                  className="underline text-note-full"
                  href="mailto:huuthang.l@outlook.com"
                >
                  huuthang.l@outlook.com
                </a>
                . Include your browser/OS, what you were doing, and any console
                errors if you have them.
              </p>
            </div>

            <div className="bg-card-bg p-3 rounded-lg">
              <h4 className="font-semibold">
                6. Some fingering patterns are missing?
              </h4>
              <p className="mt-2">
                The chart covers the soprano recorder. Some alternate fingerings
                from reference materials aren't in yet, but they're planned. You
                can switch between available fingering systems in the Instrument
                Controller. The chart was sourced from{" "}
                <a
                  className="underline text-note-full"
                  href="/references/recorder-fingering-chart.png"
                  target="_blank"
                  rel="noreferrer"
                >
                  this soprano recorder fingering reference
                </a>
                .
              </p>
            </div>
          </div>
        </div>

        {/* Donate & credit */}
        <div className="pt-6 flex flex-col items-center gap-3">
          <a
            href="https://buymeacoffee.com/huuthang.le"
            target="_blank"
            rel="noopener"
          >
            <img
              src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png"
              alt="Buy Me A Coffee"
              width="150"
            />
          </a>

          <div className="text-sm text-main/80 flex items-center gap-2">
            <span>Made by</span>
            <a
              href="https://www.linkedin.com/in/huuthangle/"
              target="_blank"
              rel="noopener"
              className="flex items-center gap-2 underline text-note-full"
            >
              {/* LinkedIn logo (simple, small) */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                width="18"
                height="18"
                className="fill-current"
                aria-hidden="true"
              >
                <path d="M4.98 3.5C4.98 4.88 3.87 6 2.5 6S0 4.88 0 3.5 1.11 1 2.5 1 4.98 2.12 4.98 3.5zM0 8h5v16H0zM7.5 8h4.8v2.2h.1c.7-1.3 2.4-2.7 4.9-2.7 5.2 0 6.2 3.4 6.2 7.8V24h-5V16.2c0-1.9 0-4.4-2.7-4.4-2.7 0-3.1 2.1-3.1 4.3V24h-5V8z" />
              </svg>
              Huu Thang Le
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
