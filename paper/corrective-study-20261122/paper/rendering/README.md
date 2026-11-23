# Rendering sources

These sources are bound to the delivered PDF. Install requirements.lock and the system DejaVu fonts. From the package root, use a fresh rebuilt/assembled directory:

    python paper/rendering/assemble.py --source paper --output rebuilt/assembled
    python paper/rendering/render.py --source rebuilt/assembled --output rebuilt/rendered

These commands were executed once on AWS with the pinned render environment. All 32 extracted page texts and all 32 page images at 90 dpi matched the delivered PDF. Generated PDF metadata can change the byte hash. The delivered PDF remains the exact original AWS-rendered file. Numerical reproduction is separate.
