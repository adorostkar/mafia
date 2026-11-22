import { factions, roleIds, roles } from "../shared/game";
import type { Translation } from "./i18n";
import { Emblem, Icon } from "./Art";
import { CharacterLibrary } from "./CharacterLibrary";

export type LearningSection = "rules" | "characters";

export function FactionPreview({
  t,
  onLearn,
}: {
  t: Translation;
  onLearn: () => void;
}) {
  return (
    <section className="cast-section" aria-labelledby="factions-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t.text.afterDark}</p>
          <h2 id="factions-title">{t.text.factionsTitle}</h2>
          <p className="muted">{t.text.castIntro}</p>
        </div>
        <span className="star-mark" aria-hidden="true">
          ✦
        </span>
      </div>
      <div className="faction-grid">
        {factions.map((faction) => (
          <article className={`faction-card ${faction}`} key={faction}>
            <div className="card-top">
              <span className="eyebrow">
                {t.message("rolesCount", {
                  count: roleIds.filter(
                    (role) => roles[role].faction === faction,
                  ).length,
                })}
              </span>
              <span aria-hidden="true">✦</span>
            </div>
            <Emblem faction={faction} />
            <h3>{t.faction[faction]}</h3>
            <p>{t.text[`${faction}Motto`]}</p>
          </article>
        ))}
      </div>
      <div className="library-callout">
        <button className="secondary" onClick={onLearn}>
          {t.text.characterLibrary}
          <Icon name="arrow" />
        </button>
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
              <span className="step">
                {t.number(index + 1).padStart(2, t.number(0))}
              </span>
              <h2>{t.rulebook[`${key}Title`]}</h2>
              <p>{t.rulebook[key]}</p>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
