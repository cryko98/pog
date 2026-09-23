import { GATHER, SKILLS, SKILL_MAX, gatherYield, playerLevel, skillLevel } from '../../shared/world.js';
import { Icon, type IconName } from './Icon';

interface Props {
  skills: Record<string, number>;
  onClose: () => void;
}

const RESOURCE: Record<string, string> = { tree: 'wood', ice: 'ice', hole: 'fish' };

/**
 * Where the player stands: the number over their head, and the three
 * trades under it — how far each has come, how far to the next level,
 * and what that level is worth in the pack.
 */
export function SkillsPanel({ skills, onClose }: Props) {
  const total = playerLevel(skills);
  const kinds = Object.keys(SKILLS) as Array<keyof typeof SKILLS>;

  return (
    <div className="panel side-panel skills">
      <div className="bp-head">
        <h4>
          <Icon name="trophy" size={16} /> Level {total}
        </h4>
        <button className="bp-close" onClick={onClose} aria-label="Close">
          <Icon name="close" size={15} />
        </button>
      </div>
      <p className="bp-note">
        Your level is the three trades added up. Each one climbs by doing it — every pine felled, block
        cut or fish landed counts — and higher levels haul more per go. Skills never touch Frost.
      </p>

      {kinds.map((kind) => {
        const s = skillLevel(skills[kind] || 0);
        const rule = GATHER[kind];
        const res = RESOURCE[kind];
        const yieldNow = (gatherYield(kind, s.count) as Record<string, number>)[res] ?? 0;
        // the next level that adds one more to the haul
        const bonusNow = Math.floor((s.level - 1) / rule.bonusEvery);
        const nextBonusLevel = (bonusNow + 1) * rule.bonusEvery + 1;
        const pct = s.span ? Math.min(100, (s.into / s.span) * 100) : 100;
        return (
          <div className="sk-row" key={kind}>
            <div className="sk-head">
              <span className="with-icon">
                <Icon name={SKILLS[kind].icon as IconName} size={16} />
                <b>{SKILLS[kind].label}</b>
              </span>
              <span className="sk-level">
                Lv {s.level}
                <small> / {SKILL_MAX}</small>
              </span>
            </div>
            <div className="q-bar">
              <i style={{ width: `${pct}%` }} />
            </div>
            <small className="sk-meta">
              {s.count.toLocaleString('en-US')} {SKILLS[kind].verb}
              {s.next !== null ? ` · ${(s.next - s.count).toLocaleString('en-US')} more to level ${s.level + 1}` : ' · maxed'}
            </small>
            <small className="sk-meta">
              {yieldNow} {res} per {kind === 'hole' ? 'catch' : kind === 'tree' ? 'pine' : 'block'}
              {nextBonusLevel <= SKILL_MAX ? ` · +1 at level ${nextBonusLevel}` : ''}
            </small>
          </div>
        );
      })}
    </div>
  );
}
