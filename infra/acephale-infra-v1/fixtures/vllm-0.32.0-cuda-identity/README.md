These are the public, unmodified Docker Registry response bytes for the already
pinned `vllm/vllm-openai:v0.32.0` image, obtained on 2026-11-10. Tests verify the
index digest, its Linux amd64 manifest digest and size, and that manifest's config
digest and size. Whitespace is part of the digest; do not reformat these files.

The config establishes `CUDA_VERSION=13.0.2` as the image-base release. It does
not establish one patch version for all installed CUDA components or the entire
toolkit. Actual PyTorch compile-version and runtime qualification are separate.

Index: `sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34`

Linux amd64: `sha256:6ee133356d49ed24cee03dd0cda3d3980279a11c107ce3e752c89e76540f41c9`

Config: `sha256:bd8a5d7a8774800c92d714c0c226b32c1863f929150f36efd610aebcd12a335d`
