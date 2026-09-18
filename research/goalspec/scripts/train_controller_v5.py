import argparse
import json
from goalspec.controller_v5 import train

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset")
    parser.add_argument("output")
    parser.add_argument("--epochs", type=int, default=120)
    args = parser.parse_args()
    if not 1 <= args.epochs <= 1000:
        parser.error("epochs must be between 1 and 1000")
    print(json.dumps(train(args.dataset, args.output, args.epochs), indent=2))
