# Multi-model adaptive affection assessment

This is an original, uncalibrated preference quiz, not a validated psychological assessment or official questionnaire. Three frameworks: Chapman-inspired classic five, Truity-inspired seven, and Flicker et al.-inspired ten. Category mappings and intensity values are author estimates. The ten-category framework includes relationship behaviours that are not necessarily interchangeable affection preferences. Do not claim compatibility, diagnosis, or population percentiles.

The [quiz](https://medrum.github.io/love-language-test/) runs on GitHub Pages. Each question links to a public GitHub issue draft with its ID filled in. Sessions and their question bank revisions are stored in IndexedDB on this browser. The quiz sends a copy only when the visitor chooses **Save a server copy**. JSON exports include question IDs, canonical answers and the order in which the options appeared.

The answer format can be changed throughout a session. A/B answers and strong preferences use the existing binary scoring. Slight preferences use a response of 0.75 or 0.25 in the existing likelihood, and equally appealing uses 0.5. Skip contributes no scoring evidence. JSON preserves the preference as `slight`, `strong`, or `equal` alongside the canonical answer ID and display order. For compatibility with the existing API, an equal response has an `answer` of `skip` plus `preference: "equal"`. The summary keeps directional responses in `answered` and equal responses in `equal`. The quiz combines them when displaying the answered count.

Open a saved session from its link or paste its slug on the quiz homepage. An opened link is recorded in the browser's session list. A server save includes the current question and its display order so another browser can continue at the same point. Older copies can resume from their last saved answer when the original question bank is available. Changing frameworks reuses eligible answers. Choose **Answer 12 more questions** to continue beyond the previous stopping point.

## Files
- `index.html`, `quiz.js` and `quiz.css`: the static quiz frontend. `style.css` and `theme.js` are copied from the portfolio so the quiz can run independently.
- `questions.json`: The question bank, eligibility, category mappings and session lengths. Schema version 8 revises comparisons from feedback and keeps their IDs for issue links. The separate disagreement prompt is for reflection only.
- `records.js` and `quiz-run.js`: Browser session storage, JSON export, server requests and result summaries.
- `backend/`: The optional standard-library Python result API, Docker Compose setup and Nginx routing for the Pi.
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

Information gain approximation in bits: 0.5*log2(1+p*(1-p)*x^T covariance x). This is a local Gaussian/Fisher (D-optimal) approximation, not exact BALD. Sum across eligible unfinished models as multi-objective utility; not independent bits in a single answer. Add 0.05 per eligible category appearance below minimum coverage and divide by 1+diversityPenalty*prior gesture appearances. The quiz picks from matched-strength comparisons for the first six answered questions whenever eligible matched candidates exist. After that, a one-step difference is allowed, with its selection score multiplied by 0.75 so it must offer enough information or coverage to compete with a matched pair. These are editorial defaults. Matching strength tags does not establish that two gestures feel equally meaningful to everyone.

## Stopping and certainty
The default short quiz allows 24 questions for one framework and 30 for several. Extended mode allows 48 or 60. Earlier completion is available from the preliminary results. Selection gives extra weight to categories with no answers. Opening comparisons favor matched strengths for the first six answered questions.

A framework reaches its full-profile precision target when the answered comparison graph is connected, every category has at least three appearances, and the largest posterior standard deviation of any category difference is at most 0.6. The separate top-two certainty is the normal posterior estimate that the highest scoring category outranks the runner-up, shown only when both have received evidence. It is a model estimate about those two categories. Softmax scores sum to 100 within a framework.

Score bars show approximate 90% model ranges. The delta method propagates the fitted covariance through each category's log odds before converting the endpoints back to percentages. The ranges travel with saved summaries and exports. Older results can reconstruct ranges when the same question bank revision and original answers are available.

Example override: `new Assessment(bank, ['modern7'], {targetPairwiseSD: 0.9, maxQuestions: 45})`. This trades precision for length and needs pilot evaluation.

## Tests
Run `node test.mjs` for category pairs, all seven framework combinations, balanced openings, context coverage, skips, undo and restore. Run `python3 -m unittest discover -s backend` for password handling, CRUD, conflicts and persistence across restarts.

## Result API
The frontend runs on GitHub Pages. The API runs on the Pi at `https://lovelang.fabianflow.de/api/v1`. Compose uses a persistent SQLite volume and the existing Docker `proxy` network. The Nginx configuration proxies the API and makes `/r/{slug}` open the shared result viewer. The Cloudflare Tunnel routes the hostname to Nginx.

| Method | Path | Behavior |
|---|---|---|
| PUT | `/api/v1/results/{slug}` | Create (201) or replace the same session (200) using the exported JSON schema. A taken slug or stale update returns 409. |
| GET | `/api/v1/results/{slug}` | Read the saved result and metadata. |
| PATCH | `/api/v1/results/{slug}` | Edit any of `name`, `slug`, or `newPassword` in place. An empty new password removes protection. Renaming releases the previous slug. |
| DELETE | `/api/v1/results/{slug}` | Remove the server copy (204). |

Use HTTPS Basic authentication with the username `result` and the chosen password. Supplying a password on creation protects future reads, updates and deletes. A password can also be added to an existing public copy by updating it. An unprotected result is accessible to anyone who knows its slug. The database stores result data in plaintext and stores passwords as salted scrypt hashes. The frontend keeps passwords in memory during requests and sends them over HTTPS.

## Content review and future calibration
Comparisons pair context-compatible gestures and apply model tags. Structural validation is automated, but each generated comparison has not received independent human review. Review semantics, overlapping categories, consent/accessibility, cultural/context effects, and differences in gesture intensity before production. The scored accountability comparisons cover everyday compromises at equal strength. The optional disagreement follow-up is a personal reflection question with no scoring. Some mappings are necessarily approximate; general quality time intentionally has no automatic mapping to activity or the expanded model. The expanded model categories are research-inspired, not a reproduction of the original scale. Preserve null mappings instead of forcing categories.
Pilot randomized responses, estimate item offsets with shrinkage, check held-out predictions, test–retest, response ordering and context effects. Simulate a range of profiles and answer noise; compare question lengths and recovery errors for each configuration. Calibrate precision against actual recovery error. Consider context and gesture-specific uncertainty to avoid excessive confidence from repeated similar gestures. Do not claim scientifically validated certainty based only on the model's posterior.

## Background references (from prior design)
- https://5lovelanguages.com/quizzes/love-language
- https://www.truity.com/test/love-styles-test
- https://doi.org/10.1177/09637214231217663
- https://doi.org/10.1111/jmft.70078
- https://doi.org/10.1111/jmft.70072
- https://doi.org/10.3102/1076998619890589
