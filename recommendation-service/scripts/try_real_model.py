"""Manual check that the real local model works and ranks by meaning, not shared words.

    .\.venv\Scripts\python.exe scripts\try_real_model.py

Downloads BAAI/bge-small-en-v1.5 (about 130 MB) on first run. Not part of pytest because it needs
the network once.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.embedder import FastEmbedEmbedder  # noqa: E402

emb = FastEmbedEmbedder("BAAI/bge-small-en-v1.5", os.environ.get("RECO_MODEL_CACHE") or None)
products = [
    "Trail running shoes\nFootwear\nGrippy sneakers for jogging on muddy paths",
    "Leather office loafers\nFootwear\nFormal slip-on shoes for the workplace",
    "Ceramic coffee mug\nKitchen\nStoneware cup that keeps your tea and coffee warm",
    "Stainless steel water bottle\nKitchen\nInsulated flask for hot and cold drinks",
    "Wireless earbuds\nElectronics\nBluetooth headphones with noise cancelling",
]
vecs = emb.embed_documents(products)
print("dims:", vecs.shape[1])
for query in ["something to drink my morning coffee from", "shoes for a marathon", "music on the go", "quantum physics textbook"]:
    q = emb.embed_query(query)
    scores = vecs @ q
    best = int(scores.argmax())
    print(f"{query!r:50} -> {products[best].splitlines()[0]!r} (score {scores[best]:.2f}; all: {[round(float(s), 2) for s in scores]})")
