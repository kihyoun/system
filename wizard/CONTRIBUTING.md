# Contributing

System Bootstrapper began with Ki-Hyoun Kim's architecture and implementation in
2019. Contributions continue that work under the [MIT license](LICENSE).
Third-party code retains its own notices and licenses. Read the
[Code of Conduct](CODE_OF_CONDUCT.md) and [security policy](SECURITY.md).

## Discuss and prepare

[GitLab is the central requirements tracker](https://gitlab.system-bootstrapper.com/system-bootstrapper/system/-/issues) for System and Wizard.
Search existing issues before proposing a change. The GitHub repositories present
and mirror the code; open merge requests and run CI in GitLab. Do not open a
parallel GitHub issue or pull request. Private source-project access is granted
by maintainers: email [kihyoun@gmail.com](mailto:kihyoun@gmail.com) to request
contribution access when you cannot open an issue in the private project.
Use the private reporting routes in the security and conduct policies for
sensitive reports. Email is an initial contact route, not a parallel tracker.

Read the README and AGENTS.md in the affected repository. Clone System with its
pinned Wizard submodule (`git submodule update --init --recursive`), or use the
standalone Wizard checkout for Wizard-only development. Follow the documented
host prerequisites; do not copy a maintainer's private configuration. Keep secrets
and deployment inputs outside the checkout.

## Develop and verify

Create a focused branch from the current default branch. Keep commits reviewable,
write documentation in English and explain observable behavior. Preserve the
exact System Cube signature, port 8071 and the saved configuration/recovery
contracts. Do not update a historical migration recipe or recorded release image
identity as an ordinary dependency bump.

For System, use the component and integration commands in `tests/README.md`;
run the checks relevant to the change. For Wizard, use `npm ci`, `npm run build`
and its documented browser checks. Use its declared supported Node version.
Infrastructure and runtime changes retain the required component, browser,
candidate-image and disposable platform gates. Documentation-only changes use the
native documentation lane. Never bypass checks to reduce an update's cost.

For a bundled change, keep the tested Wizard source revision and System gitlink
consistent. A Wizard merge alone does not update the System pin or Production.
Dependency Dashboard approval permits Renovate to propose a grouped update; it
does not approve its merge, license changes or a deployment.

## Submit a GitLab merge request

Use the merge-request template in the affected source project. Explain the problem,
resulting behavior, relevant checks and recovery/migration implications. Include
reproduction steps and screenshots when they clarify a UI change. Remove private
configuration, credentials and unrelated logs. Address review feedback and keep
the required pipeline gates enabled. Maintainers review and merge; deploying a
new controller or Wizard remains an explicit, evidence-bound operator action.

By submitting work you confirm you have permission to contribute it under MIT.
Identify third-party material and preserve its notices. Do not remove historical
authorship or claim that AI created the project's original architecture.
