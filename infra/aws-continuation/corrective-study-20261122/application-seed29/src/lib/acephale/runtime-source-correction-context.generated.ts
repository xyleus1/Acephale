/* Generated from verified source authority and build evidence. Identity only. */
import type { ExpectedRuntimeCorrection } from "./runtime-source-correction";
export const sourceBoundRuntimeCorrection: ExpectedRuntimeCorrection | undefined = {
  "authoritySha256": "94a9da7794682548828e8ea26aec6343713b50a89a839763436a45475d70f645",
  "baseImageId": "sha256:befccf0e7e4089aa23926bb6f887a85c0d46c2a99e6de5c5ffdf5cb7957c5b34",
  "changedFiles": {
    "/usr/local/lib/python3.12/dist-packages/vllm/ir/ops/layernorm.py": "b64b44871c8cf0da893e7db9f8e4e9b06c90c957ebf1843b1be3fe4e1233d3e6",
    "/usr/local/lib/python3.12/dist-packages/vllm/model_executor/layers/activation.py": "41b7b94909a4c391a857d0dc77e5a4c8b777e6d54fcb9ad1a93a067dbad36a0b",
    "/usr/local/lib/python3.12/dist-packages/vllm/model_executor/layers/mamba/ops/causal_conv1d.py": "8b772f74811a6ef008c551340fc8a872978b83e616fe8fdff22311e89743e80b",
    "/usr/local/lib/python3.12/dist-packages/vllm/third_party/flash_linear_attention/ops/chunk_scaled_dot_kkt.py": "05ea9ad35ffa9024d5cc5fa65b83d7c796e57f1f262278c3136c6f7600a6633a",
    "/usr/local/lib/python3.12/dist-packages/vllm/third_party/flash_linear_attention/ops/fused_gdn_prefill_post_conv.py": "f03089c0805edf80822f88525514d9361c30014c5351433c0784a38c8cca3f01",
    "/usr/local/lib/python3.12/dist-packages/vllm/third_party/flash_linear_attention/ops/fused_recurrent.py": "71c402ef6335e9ced5e71f25f43c978f470ff507b93afcff9c668dea6abe2f99",
    "/usr/local/lib/python3.12/dist-packages/vllm/third_party/flash_linear_attention/ops/fused_sigmoid_gating.py": "691ab98586417ce60a66dea51ebbcc21943aa54bfb739186cbe5efd21c1cd26b"
  },
  "manifestContentHash": "3e64cf9c516d0615b692edcd3266a3322cb90ff8499f5f3f60608ec183445ed1",
  "manifestFileSha256": "e20309c27e5c5d41df30e89cb0613feb4fb5c9c15b32f291072aedc2a9febafb",
  "predictorImageId": "sha256:6ea449937dbc664891737d6d4618c7e6ce9281ce2997cc61b34905353675c901",
  "unchangedNative": {
    "/usr/local/lib/python3.12/dist-packages/vllm/_C_stable_libtorch.abi3.so": "ae9c8a293020e422e0b6b61d1024263dc476a772337f5d39d46d18baa7ce0ad9"
  }
};
