# Bounded native preview evidence

The explicit preview setup workflow uses the existing GitLab Rails adapter,
project receipts and live-state lease. It does not introduce a background
service, a separate credential store or another job scheduler.

Native source discovery and adoption collect dependent evidence within one
bounded Rails invocation per phase. Each invocation permits at most 32 scoped
GETs and 1,500,000 bytes of aggregate response data. The currently supported
23-file CI manifest needs 30 GETs for discovery and 30 each for adoption plan
and apply. Combining these reads reduces six Rails starts to three without
removing any evidence reads. Larger valid manifests retain the existing bounded
multi-invocation path; the limits are not increased.

The collector checks the exact required jobs, commit and pipeline before reading
artifacts. JavaScript independently validates the returned job, source, image,
artifact and CI-file evidence. Apply obtains a new collector response while
holding the native ownership lock; it does not reuse the plan's results. Every
CI blob is read and hashed again for apply. Responses live only within their
own phase, and unexpected or exhausted route reads fail closed. The existing
outer dispatcher creates and revokes its temporary credential on success,
refusal and transport failure.

Use the existing [component test workflow](../../tests/README.md) to build the
disposable `system-component-tests` image from committed inputs. Focused checks
inside that image need no network or Docker socket:

```sh
docker run --rm --network none --entrypoint ruby system-component-tests tests/gitlab/preview-setup.rb
docker run --rm --network none --entrypoint node system-component-tests tests/wizard/source-primary-adoption.js
docker run --rm --network none --entrypoint node system-component-tests tests/wizard/preview-setup-workflow.js
docker run --rm --network none --entrypoint node system-component-tests tests/wizard/rails-completion.js
```

These checks use the actual Ruby collector and native JavaScript adoption,
compare the job gates across both languages, retain fresh under-lock reads,
exercise malformed/oversized/unscoped responses and credential cleanup, and
verify the larger-manifest fallback. The existing full candidate still proves
real GitLab CI, adoption, Review/Beta deployment and recovery; these focused
checks do not replace it.
