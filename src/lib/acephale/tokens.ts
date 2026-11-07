import { getEncoding } from "js-tiktoken";

// One encoding table per process, shared by all predictor and actor compilers.
const encoding = getEncoding("o200k_base");
export const countTokens = (text: string) => encoding.encode(text).length;
