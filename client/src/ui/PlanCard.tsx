// Plan cards (D-071 §4, UI.md §3 "Planning"): the card of a selected
// planned building or field ("Planned: X") and of a planned road segment
// ("Planned road · N tiles"), plus the farm card's planned-fields block.
// Display only (D-027): the cost and the reason are the server's
// (`plan_cost`); the client marks the parts the island cannot cover now
// and never disables Build — the server decides.
import { Fragment } from "react";
import type { Content, DisplayState, IslandDisplay, PlanCostDisplay, PlanDisplay, PlannedRoadDisplay } from "../api/client";
import { errorText } from "../api/errors";
import { tons, units } from "../display/format";
import { planCostParts, planFarmOf } from "../display/plans";
import { inSentence, t } from "../i18n";
import { goodIcon, toolIcon } from "../theme/iconSet";
import { CloseButton } from "./CloseButton";
import styles from "./hud.module.css";
import { Icon } from "./Icon";
import { PaintButton } from "./InfoPanel";

/** The plan's cost in build-menu format (short parts red) and, when building would fail now, the server's reason. */
export function PlanCost({ cost, island, gold, content, testId }: { cost: PlanCostDisplay; island: IslandDisplay; gold: number; content: Content; testId: string }) {
  const parts = planCostParts(cost, gold, (good) => island.inventory[good]?.stock ?? 0);
  const goodName = (id: string) => content.goods.find((g) => g.id === id)?.name ?? id;
  return (
    <>
      <div className={`${styles.small} ${styles.costLine}`} data-testid={`${testId}-cost`}>
        <span>{t("plan.cost")}</span>
        <span className={parts.gold.short ? styles.warn : undefined} data-short={parts.gold.short || undefined}>
          {t("build.goldCost", { amount: units(parts.gold.amount) })}
        </span>
        {parts.materials.map((m) => (
          <Fragment key={m.good}>
            <span aria-hidden="true">·</span>
            <span className={`${styles.withIcon} ${m.short ? styles.warn : ""}`} data-short={m.short || undefined} title={goodName(m.good)}>
              <Icon path={goodIcon(m.good)} />
              {tons(m.amount)}
            </span>
          </Fragment>
        ))}
      </div>
      {cost.reason && (
        <div className={`${styles.small} ${styles.warn}`} data-testid={`${testId}-reason`}>
          {t("plan.wouldFail", { reason: errorText(cost.reason) })}
        </div>
      )}
    </>
  );
}

interface PlanCardProps {
  plan: PlanDisplay;
  island: IslandDisplay;
  model: DisplayState;
  content: Content;
  onBuild: () => void;
  /** Lifts the plan into a move ghost (not for a planned field: it follows its farm). */
  onMove: () => void;
  onDemolish: () => void;
  /** A planned farm: the field tool on it (`remove`: its removal mode), its fields are planned. */
  onPaintFields: (fieldType: string, remove?: boolean) => void;
  onClose: () => void;
}

/** The card of a planned building or field (D-071 §4): "Planned: X", the cost line, the server's reason and Build · Move · Demolish. */
export function PlanCard({ plan, island, model, content, onBuild, onMove, onDemolish, onPaintFields, onClose }: PlanCardProps) {
  const def = content.buildings.find((d) => d.id === plan.type);
  const name = def?.name ?? plan.type;
  const field = plan.farm_id !== undefined;
  // A planned field builds with its farm: the farm's cost (its planned fields included).
  const farm = field ? planFarmOf(island, plan) : {};
  const farmName = (type: string | undefined) => inSentence(type ? (content.buildings.find((d) => d.id === type)?.name ?? type) : "");
  const cost = field ? (farm.plan?.plan_cost ?? farm.building?.planned_fields?.plan_cost) : plan.plan_cost;
  const fieldDef = def?.fields ? content.buildings.find((d) => d.id === def.fields?.type) : undefined;
  const plannedFields = def?.fields ? (island.plans ?? []).filter((p) => p.farm_id === plan.id).length : 0;
  return (
    <div className={`${styles.panel} ${styles.infoPanel}`} data-testid="plan-card">
      <div className={styles.row}>
        <h2 className={styles.title} data-testid="plan-name">
          {t("plan.title", { name })}
        </h2>
        <div className={styles.spacer} />
        <CloseButton onClick={onClose} testId="plan-close" />
      </div>
      <div className={styles.panelBody}>
        <div className={styles.statusRow}>
          <span className={styles.icon} role="img" aria-label={t("build.planning")}>
            <Icon path={toolIcon("plan")} />
          </span>
          <div data-testid="plan-status">
            {field
              ? farm.plan
                ? t("plan.fieldOfPlannedFarm", { farm: farmName(farm.plan.type) })
                : t("plan.fieldOfFarm", { farm: farmName(farm.building?.type) })
              : t("plan.status")}
          </div>
        </div>
        {fieldDef && def?.fields && (
          <div className={styles.section} data-testid="plan-fields">
            <div className={styles.small} data-testid="plan-fields-count">
              {t("plan.fieldsPlanned", { planned: plannedFields, max: def.fields.max })}
            </div>
            <PaintButton field={fieldDef} full={plannedFields >= def.fields.max} free onPaint={(remove) => onPaintFields(fieldDef.id, remove)} />
          </div>
        )}
        {cost && (
          <div className={styles.section}>
            <PlanCost cost={cost} island={island} gold={model.gold} content={content} testId="plan" />
          </div>
        )}
      </div>
      <div className={`${styles.buttons} ${styles.panelFooter}`}>
        <button type="button" className={styles.button} onClick={onBuild} data-testid="plan-build">
          <Icon path={toolIcon("build")} /> {field ? t("plan.buildFields") : t("plan.build")}
        </button>
        {!field && (
          <button type="button" className={styles.button} onClick={onMove} data-testid="plan-move">
            <Icon path={toolIcon("move")} /> {t("infoPanel.move")}
          </button>
        )}
        <button type="button" className={`${styles.button} ${styles.danger}`} onClick={onDemolish} data-testid="plan-demolish">
          <Icon path={toolIcon("demolish")} /> {t("infoPanel.demolish")}
        </button>
      </div>
    </div>
  );
}

interface PlannedRoadCardProps {
  road: PlannedRoadDisplay;
  island: IslandDisplay;
  model: DisplayState;
  content: Content;
  onBuild: () => void;
  onDemolish: () => void;
  onClose: () => void;
}

/** The card of a planned road segment (D-071 §4): "Planned road · N tiles", its type, cost and reason, Build · Demolish. */
export function PlannedRoadCard({ road, island, model, content, onBuild, onDemolish, onClose }: PlannedRoadCardProps) {
  const name = content.buildings.find((d) => d.id === road.type)?.name ?? road.type;
  return (
    <div className={`${styles.panel} ${styles.infoPanel}`} data-testid="planned-road-card">
      <div className={styles.row}>
        <h2 className={styles.title} data-testid="planned-road-name">
          {t("plan.road", { count: road.tiles.length })}
        </h2>
        <div className={styles.spacer} />
        <CloseButton onClick={onClose} testId="plan-close" />
      </div>
      <div className={styles.panelBody}>
        <div className={styles.statusRow}>
          <span className={styles.icon} role="img" aria-label={t("build.planning")}>
            <Icon path={toolIcon("plan")} />
          </span>
          <div data-testid="planned-road-type">{t("plan.roadType", { name })}</div>
        </div>
        <div className={styles.section}>
          <PlanCost cost={road.plan_cost} island={island} gold={model.gold} content={content} testId="planned-road" />
        </div>
      </div>
      <div className={`${styles.buttons} ${styles.panelFooter}`}>
        <button type="button" className={styles.button} onClick={onBuild} data-testid="planned-road-build">
          <Icon path={toolIcon("build")} /> {t("plan.build")}
        </button>
        <button type="button" className={`${styles.button} ${styles.danger}`} onClick={onDemolish} data-testid="planned-road-demolish">
          <Icon path={toolIcon("demolish")} /> {t("infoPanel.demolish")}
        </button>
      </div>
    </div>
  );
}

/** The farm card's planned fields (D-071 §4): how many, their cost and reason, and "Build planned fields". */
export function PlannedFieldsBlock({ island, model, content, count, cost, onBuild }: { island: IslandDisplay; model: DisplayState; content: Content; count: number; cost: PlanCostDisplay; onBuild: () => void }) {
  return (
    <div className={styles.section} data-testid="farm-planned-fields">
      <div className={styles.small} data-testid="farm-planned-count">
        {t("plan.plannedFields", { count })}
      </div>
      <PlanCost cost={cost} island={island} gold={model.gold} content={content} testId="farm-planned" />
      <button type="button" className={styles.button} onClick={onBuild} data-testid="farm-build-planned">
        <Icon path={toolIcon("build")} /> {t("plan.buildFields")}
      </button>
    </div>
  );
}
