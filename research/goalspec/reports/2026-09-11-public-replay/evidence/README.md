# Frozen replay evidence

These are byte-for-byte copies of the completed run manifests, summaries, gates, goal-backend records, initial goal scores, grouped split, training manifest/catalog, and classifier captures/configurations. `path-mapping.json` records original paths, archived paths, byte counts and SHA-256 hashes. Absolute paths inside the original JSON were preserved.

Classifier captures contain the frozen posteriors and per-request usage/hash records. Their prompt/event transcripts remain in the original local run directories; the classifier usage audit verified those hashes and native generation outputs before publication. To use a copied classifier cache elsewhere, create a new backend configuration pointing to its new location and preserve the cache SHA-256. Do not silently edit this evidence.

Large source corpora, trained patterns and event-level replay outputs remain local. Hashes and reproduction commands identify them. These small artifacts support inspection of the reported numbers and reuse of cached goal posteriors; replaying tool predictions still requires the source corpus, matching pattern artifact and frozen implementation. The public replay gate remains ineligible for live scheduling and SOTA claims.
