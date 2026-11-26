import { pick } from '../lib/pick.mjs';

// Experiment "Invite button copy" (flag: invite_cta, metric: invite_sent)
export async function inviteButton(flags, userId) {
  const flag = await flags.getExperimentFlag('invite_cta', userId);
  const label = pick(flag, {
    control: 'Invite your teammates to this trip',
    short: 'Send invite',
  });
  return `<button class="cta" data-event="invite_sent">${label}</button>`;
}
