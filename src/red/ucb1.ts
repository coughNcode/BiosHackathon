/**
 * UCB1 (Upper Confidence Bound) adaptive attack selector.
 *
 * Treats each attack scenario as a multi-armed bandit arm. Reward = 1 when
 * the attack bypasses Blue (ATTACK_BYPASS or FUNDS_LOST), 0 when blocked.
 * The bandit learns which attacks are most effective and focuses there,
 * while still exploring new variations.
 */
import type { Classification, UCB1ArmState, UCB1State } from "./types.js";
import { SCENARIO_CATALOG } from "./scenarios.js";

const EXPLORATION_CONSTANT = Math.sqrt(2);

/** Create initial UCB1 state from the scenario catalog. */
export function createUCB1State(): UCB1State {
  return {
    totalPulls: 0,
    arms: SCENARIO_CATALOG.filter((s) => s.expectedDecision === "BLOCK").map((s) => ({
      attackId: s.id,
      pulls: 0,
      totalReward: 0,
      avgReward: 0,
      ucbScore: Infinity, // unpulled arms have infinite UCB
    })),
    lastSelected: null,
    explorationConstant: EXPLORATION_CONSTANT,
  };
}

/**
 * Select the next attack to run using UCB1.
 *
 * Arms with zero pulls get infinite UCB and are selected first (round-robin
 * exploration). After all arms have been tried at least once, the arm with
 * the highest UCB1 score is selected.
 */
export function selectArm(state: UCB1State): string {
  // Any unpulled arm gets priority
  const unpulled = state.arms.find((a) => a.pulls === 0);
  if (unpulled) return unpulled.attackId;

  // UCB1 formula: avg_reward + C * sqrt(ln(total_pulls) / arm_pulls)
  let bestArm = state.arms[0];
  let bestScore = -Infinity;

  for (const arm of state.arms) {
    const exploitation = arm.avgReward;
    const exploration =
      state.explorationConstant * Math.sqrt(Math.log(state.totalPulls) / arm.pulls);
    const score = exploitation + exploration;

    if (score > bestScore) {
      bestScore = score;
      bestArm = arm;
    }
  }

  return bestArm.attackId;
}

/**
 * Update a UCB1 arm with the result of an attack.
 *
 * Reward mapping:
 *   ATTACK_BYPASS  → 1.0 (attack succeeded, Blue failed)
 *   FUNDS_LOST     → 1.0 (worst case for Blue = best case for Red)
 *   ATTACK_BLOCKED → 0.0 (Blue defended successfully)
 *   ATTACK_ERROR   → not counted (don't penalize for infrastructure issues)
 *   VALID_SUCCESS  → not applicable (control scenario)
 *   FALSE_POSITIVE → 0.5 (interesting signal — Blue over-blocked)
 */
export function updateArm(
  state: UCB1State,
  attackId: string,
  classification: Classification,
): UCB1State {
  if (classification === "ATTACK_ERROR") {
    // Infrastructure failures are not counted
    return state;
  }

  const reward = classificationToReward(classification);
  const updatedArms = state.arms.map((arm) => {
    if (arm.attackId !== attackId) return arm;

    const newPulls = arm.pulls + 1;
    const newTotalReward = arm.totalReward + reward;
    return {
      ...arm,
      pulls: newPulls,
      totalReward: newTotalReward,
      avgReward: newTotalReward / newPulls,
      ucbScore: 0, // recalculated on next select
    };
  });

  return {
    ...state,
    totalPulls: state.totalPulls + 1,
    arms: updatedArms,
    lastSelected: attackId,
  };
}

function classificationToReward(c: Classification): number {
  switch (c) {
    case "ATTACK_BYPASS":
    case "FUNDS_LOST":
      return 1.0;
    case "FALSE_POSITIVE":
      return 0.5;
    case "ATTACK_BLOCKED":
    case "VALID_SUCCESS":
      return 0.0;
    case "ATTACK_ERROR":
      return 0;
  }
}

