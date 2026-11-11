import {generateSchedule, dramaTitle} from './schedule.js';
// One incomplete platform plan must not prevent access to the rest of the library.
export function collectAirings(dramas, changes = []) {
  const slots = [], errors = [];
  for (const drama of dramas) for (const rule of drama.rules || []) {
    try {
      let rows = generateSchedule(drama, rule);
      for (const change of changes.filter(c => c?.original?.dramaId === drama.id && c.original.ruleId === rule.id)) {
        rows = rows.map(slot => slot.id === change.original.id ? change.original : slot);
        if (change.replacement) rows.push(change.replacement);
      }
      slots.push(...rows);
    } catch (error) {
      errors.push({dramaId: drama.id, ruleId: rule.id, message: `${dramaTitle(drama)}：${error.message}`});
    }
  }
  return {slots, errors};
}
