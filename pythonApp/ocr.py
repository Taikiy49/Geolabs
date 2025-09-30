import os
import google.generativeai as genai
from dotenv import load_dotenv
from PIL import Image

# Load Gemini API Key from .env
load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
vision_model = genai.GenerativeModel("gemini-2.5-pro")

def extract_work_orders_from_image(image_path_or_file):
    """
    Extracts work order numbers from an image using Gemini.

    Parameters:
    - image_path_or_file: str or FileStorage object (from Flask)

    Returns:
    - str: Bullet list of extracted work orders or error message
    """
    prompt = """
    You are an expert document analyzer.

    Extract all valid work order numbers from the image. A valid work order follows these formats:
    - 4 digits (e.g., 8292)
    - 4 digits + dash + 2 digits (e.g., 8292-05)
    - Optional 1 uppercase letter at the end (e.g., 8292-05B)
    - Optional parentheses with 1 uppercase letter only after a dashed format (e.g., 8292-05(S))

    ❌ Do NOT include:
    - Explanations
    - Introductions like "Here is the list..."
    - Any extra commentary

    ✅ Just output a clean bullet list, like:
    - 8292
    - 8292-05
    - 8292-05B
    - 8292-05(S)

    Output **only** the bullet list. Nothing else.
    """



    try:
        # Handle file path or uploaded file object
        image = (
            Image.open(image_path_or_file)
            if isinstance(image_path_or_file, str)
            else Image.open(image_path_or_file.stream)
        )

        response = vision_model.generate_content(
            [prompt, image],
            generation_config={"temperature": 0.2}
        )

        return response.text.strip()

    except Exception as e:
        import traceback
        traceback.print_exc()
        return f"❌ Gemini error: {e}"
