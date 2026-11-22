import { useState } from "react";
import { factions, roleIds, roles, type Role } from "../shared/game";
import type { Translation } from "./i18n";
import { Emblem } from "./Art";
import { FlipCard } from "./FlipCard";

function CharacterCard({ role, t }: { role: Role; t: Translation }) {
  const [revealed, setRevealed] = useState(false);
  const faction = roles[role].faction;
  return (
    <article className={`library-card ${faction}`} aria-label={t.role[role]}>
      <FlipCard
        revealed={revealed}
        onToggle={() => setRevealed(!revealed)}
        label={t.message(revealed ? "showRoleArt" : "readRole", {
          role: t.role[role],
        })}
        announcement={t.message("roleDetails", { role: t.role[role] })}
        front={
          <>
            <div className="portrait-frame">
              <img
                className="role-portrait"
                src={`/roles/${role}.webp`}
                alt=""
                width={310}
                height={310}
                loading="lazy"
                decoding="async"
              />
              <span className="portrait-number" aria-hidden="true">
                {t.number(roleIds.indexOf(role) + 1).padStart(2, t.number(0))}
              </span>
            </div>
            <div className="portrait-caption">
              <p className="eyebrow">{t.faction[faction]}</p>
              <h4>{t.role[role]}</h4>
            </div>
          </>
        }
      >
        <div className="role-dossier">
          <p className="eyebrow">{t.faction[faction]}</p>
          <h4>{t.role[role]}</h4>
          <p>{t.roleDescription[role]}</p>
          <p className="role-limit">
            {roles[role].unique ? t.text.unique : t.text.unlimited}
          </p>
        </div>
      </FlipCard>
    </article>
  );
}

export function CharacterLibrary({ t }: { t: Translation }) {
  return (
    <section className="character-library" aria-labelledby="library-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{t.text.afterDark}</p>
          <h2 id="library-title">{t.text.meetCast}</h2>
          <p className="muted library-help">{t.text.libraryHelp}</p>
        </div>
        <span className="star-mark" aria-hidden="true">
          ✦
        </span>
      </div>
      <nav className="faction-index" aria-label={t.text.browseFactions}>
        {factions.map((faction) => (
          <a href={`#library-${faction}`} className={faction} key={faction}>
            <span className="faction-dot" aria-hidden="true" />
            {t.faction[faction]}
            <span>
              {t.number(
                roleIds.filter((role) => roles[role].faction === faction)
                  .length,
              )}
            </span>
          </a>
        ))}
      </nav>
      {factions.map((faction) => (
        <section
          className={`library-faction ${faction}`}
          key={faction}
          aria-labelledby={`library-${faction}`}
        >
          <header>
            <div>
              <p className="eyebrow">
                {t.message("rolesCount", {
                  count: roleIds.filter(
                    (role) => roles[role].faction === faction,
                  ).length,
                })}
              </p>
              <h3 id={`library-${faction}`} tabIndex={-1}>
                {t.faction[faction]}
              </h3>
              <p>{t.text[`${faction}Motto`]}</p>
            </div>
            <Emblem faction={faction} />
          </header>
          <div className="library-grid">
            {roleIds
              .filter((role) => roles[role].faction === faction)
              .map((role) => (
                <CharacterCard key={role} role={role} t={t} />
              ))}
          </div>
        </section>
      ))}
    </section>
  );
}
