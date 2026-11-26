import { pick } from '../lib/pick.mjs';

// Experiment "Pricing headline" (flag: pricing_headline, metric: plan_selected)
export async function pricingHeadline(flags, userId) {
  const flag = await flags.getExperimentFlag('pricing_headline', userId);
  const headline = pick(flag, {
    control: '$9 a month for the whole group',
    annual_first: '$89 a year for the whole group',
  });
  return `<h2>${headline}</h2><button class="plan" data-event="plan_selected">Pick this plan</button>`;
}
