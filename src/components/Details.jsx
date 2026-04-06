import { useTranslation, Trans } from "react-i18next";
import Directory from "./Directory";
import me from "../assets/me.svg";

export default function Details() {
  const { t } = useTranslation();

  return (
    <div className="space-y-4 pb-8 max-w-4xl mx-auto px-4">
      <img
        className="mx-auto rounded-full bg-main w-40 h-40"
        src={me}
        alt={t("details.avatar")}
      />
      <hr className="bg-white h-1 rounded-full opacity-20" />

      <section className="text-white">
        <div className="[&>h2]:text-4xl [&>h3]:text-2xl space-y-4">
          <h2 className="text-center mb-6">{t("details.about.title")}</h2>

          <p>
            <Trans
              i18nKey="details.about.intro"
              components={{
                synthesia: (
                  <a
                    className="underline text-note-full"
                    href="https://synthesiagame.com/"
                    target="_blank"
                    rel="noreferrer"
                  />
                ),
              }}
            />
          </p>

          <h3>{t("details.whereFrom.title")}</h3>
          <p>
            <Trans
              i18nKey="details.whereFrom.text"
              components={{
                recorderVis: (
                  <a
                    className="underline text-note-full ml-1"
                    href="https://github.com/lhuthng/RecorderVisualization"
                    target="_blank"
                    rel="noreferrer"
                  />
                ),
              }}
            />
          </p>

          <h3>{t("details.stack.title")}</h3>
          <p>{t("details.stack.text")}</p>

          <h3>{t("details.inProgress.title")}</h3>
          <ul className="list-disc list-inside space-y-1">
            <li>
              <strong>{t("details.inProgress.practiceMode")}:</strong>{" "}
              {t("details.inProgress.practiceModeText")}
            </li>
            <li>
              <strong>{t("details.inProgress.songLibrary")}:</strong>{" "}
              {t("details.inProgress.songLibraryText")}
            </li>
          </ul>

          <h3>{t("details.knownIssues.title")}</h3>
          <ul className="list-disc list-inside text-sm opacity-80 space-y-1">
            <li>{t("details.knownIssues.mobilePerf")}</li>
            <li>{t("details.knownIssues.notesOutOfRange")}</li>
            <li>{t("details.knownIssues.playmodeInput")}</li>
          </ul>

          <h3>{t("details.aboutMe.title")}</h3>
          <p>{t("details.aboutMe.text")}</p>

          <ul className="flex flex-wrap gap-4 pt-4 [&>li>a]:text-note-full [&>li>a]:underline [&>li>a]:font-medium">
            <li>
              <a
                href="https://github.com/lhuthng/synrecordia"
                target="_blank"
                rel="noreferrer"
              >
                {t("details.aboutMe.github")}
              </a>
            </li>
            <li>
              <a href="mailto:huuthang.l@outlook.com">
                {t("details.aboutMe.contact")}
              </a>
            </li>
            <li>
              <a
                href="https://blog.huuthangle.site"
                target="_blank"
                rel="noreferrer"
              >
                {t("details.aboutMe.blog")}
              </a>
            </li>
          </ul>

          <h3 className="pt-6">{t("details.faq.title")}</h3>
          <div className="space-y-3 [&>div]:bg-card-bg/70">
            {/* q1 — What kind of recorder is this for? */}
            <div className="p-3 rounded-lg">
              <h4 className="font-semibold">{t("details.faq.q1.question")}</h4>
              <p className="mt-2">
                <Trans
                  i18nKey="details.faq.q1.answer"
                  components={{
                    carryOn: (
                      <a
                        className="underline text-note-full"
                        href="https://us.carryonplaying.com/"
                        target="_blank"
                        rel="noreferrer"
                      />
                    ),
                  }}
                />
              </p>
            </div>

            {/* qTenor — What are the recorder type and simple fingering settings? */}
            <div className="p-3 rounded-lg">
              <h4 className="font-semibold">
                {t("details.faq.qTenor.question")}
              </h4>
              <p className="mt-2">{t("details.faq.qTenor.answer")}</p>
            </div>

            {/* q2 — What am I actually looking at? */}
            <div className="p-3 rounded-lg">
              <h4 className="font-semibold">{t("details.faq.q2.question")}</h4>
              <p className="mt-2">{t("details.faq.q2.intro")}</p>
              <ul className="list-disc list-inside mt-2">
                <li>{t("details.faq.q2.group1")}</li>
                <li>{t("details.faq.q2.group2")}</li>
                <li>{t("details.faq.q2.group3")}</li>
              </ul>
              <p className="mt-2">{t("details.faq.q2.outro")}</p>
            </div>

            {/* q3 — How do I open a song? */}
            <div className="p-3 rounded-lg">
              <h4 className="font-semibold">{t("details.faq.q3.question")}</h4>
              <div className="flex flex-wrap items-center mt-2 gap-2">
                <p>{t("details.faq.q3.answer")}</p>
                <Directory
                  onSelected={() => {
                    document.body.scrollTop = 0;
                    document.documentElement.scrollTop = 0;
                  }}
                />
              </div>
            </div>

            {/* q4 — Why is the audio played faster than the visualization? */}
            <div className="p-3 rounded-lg">
              <h4 className="font-semibold">{t("details.faq.q4.question")}</h4>
              <p className="mt-2">{t("details.faq.q4.answer")}</p>
            </div>

            {/* q5 — Why do some notes have audio but no visual? */}
            <div className="p-3 rounded-lg">
              <h4 className="font-semibold">{t("details.faq.q5.question")}</h4>
              <p className="mt-2">{t("details.faq.q5.answer")}</p>
            </div>

            {/* q6 — Some fingering patterns are missing? */}
            <div className="p-3 rounded-lg">
              <h4 className="font-semibold">{t("details.faq.q6.question")}</h4>
              <p className="mt-2">
                <Trans
                  i18nKey="details.faq.q6.answer"
                  components={{
                    chart: (
                      <a
                        className="underline text-note-full"
                        href="/references/recorder-fingering-chart.png"
                        target="_blank"
                        rel="noreferrer"
                      />
                    ),
                  }}
                />
              </p>
            </div>

            {/* q7 — Why is it lagging? */}
            <div className="p-3 rounded-lg">
              <h4 className="font-semibold">{t("details.faq.q7.question")}</h4>
              <p className="mt-2">{t("details.faq.q7.answer")}</p>
            </div>

            {/* q8 — Can I load my own songs? */}
            <div className="p-3 rounded-lg">
              <h4 className="font-semibold">{t("details.faq.q8.question")}</h4>
              <p className="mt-2">{t("details.faq.q8.answer")}</p>
            </div>

            {/* q9 — Found a bug or have a feature idea? */}
            <div className="p-3 rounded-lg">
              <h4 className="font-semibold">{t("details.faq.q9.question")}</h4>
              <p className="mt-2">
                <Trans
                  i18nKey="details.faq.q9.answer"
                  components={{
                    github: (
                      <a
                        className="underline text-note-full"
                        href="https://github.com/lhuthng/synrecordia"
                        target="_blank"
                        rel="noreferrer"
                      />
                    ),
                    email: (
                      <a
                        className="underline text-note-full"
                        href="mailto:huuthang.l@outlook.com"
                      />
                    ),
                  }}
                />
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
              alt={t("details.footer.buyMeACoffee")}
              width="150"
            />
          </a>

          <div className="text-sm text-main/80 flex items-center gap-2">
            <span>{t("details.footer.madeBy")}</span>
            <a
              href="https://www.linkedin.com/in/huuthangle/"
              target="_blank"
              rel="noopener"
              className="flex items-center gap-2 underline text-note-full"
            >
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
