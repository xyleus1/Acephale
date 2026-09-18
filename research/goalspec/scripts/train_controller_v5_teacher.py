import argparse
import json
from goalspec.controller_v5_teacher import fit_teacher_residual

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("base_artifact")
    parser.add_argument("joined_dataset")
    parser.add_argument("new_output")
    parser.add_argument("--epochs",type=int,default=80)
    args=parser.parse_args()
    if not 1<=args.epochs<=1000: parser.error("epochs must be between1and1000")
    print(json.dumps(fit_teacher_residual(args.base_artifact,args.joined_dataset,args.new_output,args.epochs),indent=2))
