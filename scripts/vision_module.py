"""
vision_module.py — Module de vision Zentara (Florence-2).

Analyse une image (screenshot d'app, mockup, wireframe) et extrait :
  - Layout (structure des sections)
  - Couleurs dominantes
  - Composants UI détectés
  - Suggestions de reproduction en React/Tailwind

Utilisation :
  python vision_module.py --image "chemin/vers/image.jpg"
  python vision_module.py --image "chemin/vers/image.jpg" --format json
"""

import argparse
import json
import sys
from pathlib import Path

def load_model():
    """Charge Florence-2 base (léger, tourne sur CPU)."""
    try:
        from transformers import AutoModelForCausalLM, AutoProcessor
    except ImportError:
        print("ERREUR: transformers non installé.")
        print("Lance: pip install -r requirements-vision.txt")
        sys.exit(1)

    model_id = "microsoft/Florence-2-base"
    print(f"Chargement de {model_id}...")
    
    model = AutoModelForCausalLM.from_pretrained(
        model_id,
        trust_remote_code=True,
        torch_dtype="auto",
    )
    processor = AutoProcessor.from_pretrained(
        model_id,
        trust_remote_code=True,
    )
    return model, processor


def analyze_image(model, processor, image_path: str) -> dict:
    """Analyse complète d'une image avec plusieurs prompts."""
    from PIL import Image
    
    image = Image.open(image_path).convert("RGB")
    results = {}

    # 1. Caption décrit l'image
    inputs = processor(
        text="<CAPTION>",
        images=image,
        return_tensors="pt",
    )
    generated_ids = model.generate(
        input_ids=inputs["input_ids"],
        pixel_values=inputs["pixel_values"],
        max_new_tokens=100,
        num_beams=3,
    )
    caption = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    results["caption"] = processor.post_process_generation(
        caption, task="<CAPTION>", image_size=(image.width, image.height)
    ).get("<CAPTION>", "")

    # 2. Description détaillée
    inputs = processor(
        text="<DETAILED_CAPTION>",
        images=image,
        return_tensors="pt",
    )
    generated_ids = model.generate(
        input_ids=inputs["input_ids"],
        pixel_values=inputs["pixel_values"],
        max_new_tokens=200,
        num_beams=3,
    )
    detailed = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    results["detailed_description"] = processor.post_process_generation(
        detailed, task="<DETAILED_CAPTION>", image_size=(image.width, image.height)
    ).get("<DETAILED_CAPTION>", "")

    # 3. OCR — extrait le texte visible
    inputs = processor(
        text="<OCR>",
        images=image,
        return_tensors="pt",
    )
    generated_ids = model.generate(
        input_ids=inputs["input_ids"],
        pixel_values=inputs["pixel_values"],
        max_new_tokens=200,
        num_beams=3,
    )
    ocr_result = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    results["ocr_text"] = processor.post_process_generation(
        ocr_result, task="<OCR>", image_size=(image.width, image.height)
    ).get("<OCR>", "")

    # 4. Détection d'objets (composants UI)
    inputs = processor(
        text="<OD>",
        images=image,
        return_tensors="pt",
    )
    generated_ids = model.generate(
        input_ids=inputs["input_ids"],
        pixel_values=inputs["pixel_values"],
        max_new_tokens=200,
        num_beams=3,
    )
    od_result = processor.batch_decode(generated_ids, skip_special_tokens=False)[0]
    results["objects"] = processor.post_process_generation(
        od_result, task="<OD>", image_size=(image.width, image.height)
    ).get("<OD>", {})

    return results


def format_text_report(results: dict) -> str:
    """Formate les résultats en texte lisible."""
    lines = [
        "=" * 60,
        "ZENTARA VISION — Analyse de l'image",
        "=" * 60,
        "",
        "## Description générale",
        results.get("caption", "N/A"),
        "",
        "## Description détaillée",
        results.get("detailed_description", "N/A"),
        "",
        "## Texte détecté (OCR)",
        results.get("ocr_text", "N/A"),
        "",
        "## Objets/Composants détectés",
        json.dumps(results.get("objects", {}), indent=2, ensure_ascii=False),
        "",
        "=" * 60,
    ]
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Zentara Vision — Analyse d'image avec Florence-2")
    parser.add_argument("--image", required=True, help="Chemin vers l'image à analyser")
    parser.add_argument("--format", choices=["text", "json"], default="text", help="Format de sortie")
    args = parser.parse_args()

    image_path = Path(args.image)
    if not image_path.exists():
        print(f"ERREUR: Fichier non trouvé: {image_path}")
        sys.exit(1)

    model, processor = load_model()
    results = analyze_image(model, processor, str(image_path))

    if args.format == "json":
        print(json.dumps(results, indent=2, ensure_ascii=False))
    else:
        print(format_text_report(results))


if __name__ == "__main__":
    main()
