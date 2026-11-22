import { factions, roleIds, roles } from "../shared/game";
import type { Translation } from "./i18n";
import { Emblem } from "./Art";
import { CharacterLibrary } from "./CharacterLibrary";

export type LearningSection = "rules" | "characters";

export function Cast({
  t,
  compact = false,
}: {
  t: Translation;
  compact?: boolean;
}) {
  return (
    <section
      className={`cast-section ${compact ? "compact" : ""}`}
      aria-labelledby="cast-title"
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t.text.afterDark}</p>
          <h2 id="cast-title">{t.text.meetCast}</h2>
          <p className="muted">{t.text.castIntro}</p>
        </div>
        <span className="star-mark" aria-hidden="true">
          ✦
        </span>
      </div>
      <div className="faction-grid">
        {factions.map((faction, index) => (
          <article className={`faction-card ${faction}`} key={faction}>
            <div className="card-top">
              <span className="eyebrow">0{index + 1}</span>
              <span aria-hidden="true">✦</span>
            </div>
            <Emblem faction={faction} />
            <h3>{t.faction[faction]}</h3>
            <p>{t.text[`${faction}Motto`]}</p>
            <div className="cast-roles">
              {roleIds
                .filter((role) => roles[role].faction === faction)
                .map((role) => (
                  <details key={role}>
                    <summary>{t.role[role]}</summary>
                    <p>{t.roleDescription[role]}</p>
                  </details>
                ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export function Rulebook({
  t,
  section,
  onSectionChange,
}: {
  t: Translation;
  section: LearningSection;
  onSectionChange: (section: LearningSection) => void;
}) {
  return (
    <>
      <header className="page-intro">
        <p className="eyebrow">{t.text.rules}</p>
        <h1>{t.text.rulesTitle}</h1>
        <p className="muted">{t.text.rulesIntro}</p>
      </header>
      <div
        className="switcher learning-switcher"
        role="group"
        aria-label={t.text.learningSections}
      >
        <button
          type="button"
          aria-pressed={section === "rules"}
          onClick={() => onSectionChange("rules")}
        >
          {t.text.rulesOverview}
        </button>
        <button
          type="button"
          aria-pressed={section === "characters"}
          onClick={() => onSectionChange("characters")}
        >
          {t.text.characterLibrary}
        </button>
      </div>
      {section === "characters" ? (
        <CharacterLibrary t={t} />
      ) : (
        <div className="rules-grid">
          {(
            [
              "flow",
              "voting",
              "night",
              "defense",
              "victory",
              "moderation",
              "privacy",
              "origin",
            ] as const
          ).map((key, index) => (
            <section className="panel rule-panel" key={key}>
              <span className="step">{String(index + 1).padStart(2, "0")}</span>
              <h2>{t.rulebook[`${key}Title`]}</h2>
              <p>{t.rulebook[key]}</p>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
