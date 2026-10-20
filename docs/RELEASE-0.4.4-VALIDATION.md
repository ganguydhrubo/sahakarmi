# Saved model preservation

Startup fallback previously considered every never-run coworker eligible for a different provider. A fast OpenCode connection could therefore replace a saved Claude selection while Claude was still starting.

BotStore now marks only default coworkers created by that store instance as eligible for an automatic initial model. An explicit model update removes eligibility. Loading an existing team never enables automatic reassignment. Explicit owner provider selection continues to work as before.

Validation includes a complete local repository check and regressions for saved choices with unavailable providers, both in the original store instance and after reopening persisted state. Existing ACP tests still verify first-run free-provider adoption. Automatic catalog and CLI refresh tests remain in the suite.

During installed v0.4.3 verification, four never-run saved selections changed before provider startup completed. The app was closed normally, and the original model/reasoning fields were restored from the pre-install backup. No conversations, messages or other state were replaced. v0.4.4 prevents recurrence.

v0.5.0 / PR #9 remains parked.
