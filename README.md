# Multi-model adaptive affection assessment

This is an original, uncalibrated preference quiz, not a validated psychological assessment or official questionnaire. Three frameworks: Chapman-inspired classic five, Truity-inspired seven, and Flicker et al.-inspired ten. Category mappings and intensity values are author estimates. The ten-category framework includes relationship behaviours that are not necessarily interchangeable affection preferences. Do not claim compatibility, diagnosis, or population percentiles.

The [quiz](https://medrum.github.io/love-language-test/) runs on GitHub Pages. Each question links to a public GitHub issue draft with its question ID filled in. Sign in to GitHub to write and submit a suggestion. Quiz answers and scores stay in browser memory.

## Files
- `index.html`, `quiz.js` and `quiz.css`: the static quiz frontend. `style.css` and `theme.js` are copied from the portfolio so the quiz can run independently.
- `questions.json`: 1,646 comparisons from 226 authored gestures. Each question has two options, a context, explicit Boolean eligibility for each model, category mappings and an editorial strength tier (-1, 0, +1). Schema version 6 refines disclosure and financial generosity and adds sadness, stress and joy. Retained questions keep their IDs for feedback links.
- `engine.js`: dependency-free JavaScript assessment engine, compatible with browser ES modules and modern Node.
- `test.mjs`: Node assertion tests for bank coverage, model updates, sessions, skips, undo and restoration. Run `node test.mjs`.

## Integration
```js
import { Assessment } from './engine.js';
const bank = await fetch('./questions.json').then(r => r.json());
const session = new Assessment(bank, ['classic5', 'modern7', 'research10']);
const next = session.next(); // {done, questionId, prompt, options, selection}
// Show prompt and options; never display category tags, strength or internal selection metadata.
if (!next.done) session.answer(next.options[0].id); // use actual clicked option ID
// Repeat next()/answer() until done, then:
const results = session.results();
// Save locally only, with consent; session may contain sensitive relationship preferences.
const snapshot = session.snapshot();
const resumed = Assessment.restore(bank, snapshot);
```
Use `session.answer('skip')` for neither/not applicable. Skips consume the question budget but add no evidence. `session.undo()` removes the last recorded answer and regenerates future choices. Avoid sending user responses off-device. Snapshot contains displayed option order. Do not use screen index as answer ID. `next()` returns the same pending question until answered. On bank edits bump schemaVersion or add a separate immutable bank revision before deployment; restoring sessions against modified bank contents is otherwise unsafe. Treat snapshots as trusted local data; validate untrusted imported snapshots separately.

## Eligibility modes
- `strict`: only questions eligible for every unfinished model. Can deadlock: the 255 universally eligible comparisons only cover overlapping categories, not intellectual, social inclusion, etc. A model cannot complete while some of its categories remain untested. Strict mode is provided for experimentation but is not recommended for simultaneous full profiles.
- `strict-first` (default): prefer the best shared question if its selection utility is at least 80% of the best available utility; otherwise allow a subset question. This is a deliberate relaxation of the requested intersection.
- `flexible`: maximize summed selection utility over all active models with at least one eligible model. No explicit shared preference beyond the sum.

Every eligible selected model receives each answer, even previously completed models. Refit and recheck completion after every response. Completed models do not influence the next selection unless they become uncertain again.

Truity's [Financial style](https://www.truity.com/blog/page/seven-love-styles) includes gifts as well as using financial resources to support or delight a partner. The bank includes thoughtful gifts, offering to contribute to a bike repair, and offering to cover both tickets to an outing that has already been planned. The last two only score in the seven-category framework. The ten-category Disclosure style is about your partner sharing their own private thoughts or feelings. The seven-category Emotional style is represented by support when you are having a difficult time.

The default selector samples the new sadness, stress and joy contexts by questions 4, 12 and 20 where available. When the seven-category framework is active, it also samples a personal expense offer and a shared outing offer by questions 8 and 16. A skipped example counts as shown for context coverage. Strict eligibility continues to require shared questions.

## Scoring and selection
For each model separately, x is +1 for option A category, -1 for B category. z=x·theta+beta*(strengthA-strengthB), p=sigmoid(z). The live bank sets beta to zero. Editorial strength tiers guide which gestures are paired and leave score updates to the visitor's choices. MAP minimizes sum(softplus(z)-y*z)+||theta||²/(2*priorSD²), y=1 or 0. Gaussian prior avoids infinite estimates, centers scores. Stable Newton optimization with line search. Laplace covariance is inverse Hessian at MAP. The common shift in theta is not identifiable from answers; comparisons and softmax are invariant to that shift.

Information gain approximation in bits: 0.5*log2(1+p*(1-p)*x^T covariance x). This is a local Gaussian/Fisher (D-optimal) approximation, not exact BALD. Sum across eligible unfinished models as multi-objective utility; not independent bits in a single answer. Add 0.05 per eligible category appearance below minimum coverage and divide by 1+diversityPenalty*prior gesture appearances. The quiz picks from matched-strength comparisons for the first 12 answered questions whenever eligible matched candidates exist. After that, a one-step difference is allowed, with its selection score multiplied by 0.75 so it must offer enough information or coverage to compete with a matched pair. These are editorial defaults. Matching strength tags does not establish that two gestures feel equally meaningful to everyone.

## Stopping
A model completes only when its answered comparison graph is connected, every category has >= minComparisonsPerCategory appearances, and maximum posterior SD of all pairwise differences <= targetPairwiseSD. Default 0.6 is intentionally conservative and NOT equivalent to 95% accuracy. Global maxQuestions=80. Also stop on eligible pool exhaustion or low remaining gain (unless selected comparison addresses coverage). Return explicit reasons: precision_reached, question_limit, eligible_pool_exhausted, low_information_gain. Results for unfinished models remain marked uncertain; never label a capped test complete. Use `next().reason` for the UI. An optional practical-equivalence interpretation can be computed from posterior differences and SDs, but is not implemented as a stopping rule. Softmax results sum to 100 within each model, not comparable absolute needs or probabilities of being a type.

Example override: `new Assessment(bank, ['modern7'], {targetPairwiseSD: 0.9, maxQuestions: 45})`. This trades precision for length and needs pilot evaluation.

## Tested behaviour
Every model covers every unordered category pair (10, 21 and 45), even using only matched-strength comparisons. The Node suite runs all seven framework selections and checks balanced openings, context coverage, skips, undo and restoration. With scripted answers favoring the higher editorial tier and alternating on ties, the classic framework hit its internal precision target at 48 questions. The other selections hit the 80-question limit. These simulations check engine behavior under scripted responses.

## Content review and future calibration
Comparisons pair context-compatible gestures and apply model tags. Structural validation is automated, but each generated comparison has not received independent human review. Review semantics, overlapping categories, consent/accessibility, cultural/context effects, and differences in gesture intensity before production. Accountability comparisons are restricted to equal strength and no unresolved conflict context to reduce conflation with basic relationship requirements. Some mappings are necessarily approximate; general quality time intentionally has no automatic mapping to activity or the expanded model. The expanded model categories are research-inspired, not a reproduction of the original scale. Preserve null mappings instead of forcing categories.
Pilot randomized responses, estimate item offsets with shrinkage, check held-out predictions, test–retest, response ordering and context effects. Simulate a range of profiles and answer noise; compare question lengths and recovery errors for each configuration. Calibrate precision against actual recovery error. Consider context and gesture-specific uncertainty to avoid excessive confidence from repeated similar gestures. Do not claim scientifically validated certainty based only on the model's posterior.

## Background references (from prior design)
- https://5lovelanguages.com/quizzes/love-language
- https://www.truity.com/test/love-styles-test
- https://doi.org/10.1177/09637214231217663
- https://doi.org/10.1111/jmft.70078
- https://doi.org/10.1111/jmft.70072
- https://doi.org/10.3102/1076998619890589
