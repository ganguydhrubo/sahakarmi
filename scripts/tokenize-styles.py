"""One-off migration: convert the upstream dark-only colour literals in styles.css to theme tokens.

Kept in the repo so the transformation is reviewable. Run once; it is idempotent on already
tokenized input because no raw literals remain.
"""
import re
import sys

path = sys.argv[1]
css = open(path, encoding="utf-8").read()

RGBA = {
    (255, 255, 255): "--ink-rgb",
    (0, 0, 0): "--shade-rgb",
    (5, 5, 5): "--bg-rgb", (20, 20, 20): "--bg-rgb", (29, 29, 29): "--bg-rgb",
    (36, 36, 36): "--bg-rgb", (54, 54, 54): "--bg-rgb", (119, 119, 119): "--ink-rgb",
    (117, 167, 255): "--primary-rgb", (92, 151, 255): "--primary-rgb", (86, 142, 235): "--primary-rgb",
    (69, 126, 224): "--primary-rgb", (87, 161, 255): "--primary-rgb", (63, 121, 222): "--primary-rgb",
    (132, 177, 255): "--primary-rgb", (221, 233, 255): "--primary-rgb", (237, 113, 46): "--primary-rgb",
    (86, 192, 176): "--success-rgb", (84, 185, 166): "--success-rgb",
    (255, 173, 61): "--warning-rgb",
    (224, 92, 82): "--danger-rgb", (202, 70, 60): "--danger-rgb", (196, 72, 63): "--danger-rgb",
}


def rgba(match: re.Match) -> str:
    r, g, b, a = match.group(1), match.group(2), match.group(3), match.group(4)
    token = RGBA.get((int(r), int(g), int(b)))
    if token is None:
        luminance = (int(r) + int(g) + int(b)) / 3
        token = "--bg-rgb" if luminance < 128 else "--ink-rgb"
    return f"rgb(var({token}) / {a})"


css = re.sub(r"rgba?\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([0-9.]+)\s*\)", rgba, css)
css = re.sub(
    r"rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)",
    lambda m: "var(--bg-deep)" if int(m.group(1)) < 128 else "var(--fg-strong)",
    css,
)

HEX = {
    "var(--bg-deep)": "#000 #050505 #070707 #080808 #0b0b0b #0d0d0d #0d0e0e",
    "var(--surface-1)": "#101010 #111 #111111 #141414 #161616 #171717",
    "var(--surface-2)": "#181818 #191919 #1a1a1a #1b1b1b #1c1c1c #202020",
    "var(--surface-3)": "#242424 #252525 #262626 #292929 #2a2a2a #2b2b2b #2d2d2d",
    "var(--surface-4)": "#363636 #3a3a3a",
    "var(--success-soft)": "#10241f",
    "var(--text-dim)": "#5b5b5b #6c6c6c #797976",
    "var(--text-muted)": "#a3a3a3 #a4a4a1 #b4b4b0",
    "var(--text-secondary)": "#c5c5c1 #d8d8d3",
    "var(--fg-strong)": "#e8e8e5 #e8e8e6 #ececea #ededeb #f0f0ee #f1f1ee #f1f1ef #f2f2f2 #f3f3f1 #fff",
    "var(--primary)": "#3c82f6 #397fe4 #f19d38 #f39a21 #ed712e #ff9d69 #d97757",
    "var(--primary-ink)": "#75a7ff #a8c6ff #a9c8ff",
    "var(--indigo-accent)": "#6464ef #885cf5 #8056e8",
    "var(--success)": "#54b9a6 #74cbbb #21b7ad #08a866 #8dc29c",
    "var(--danger)": "#bd554c #bc5149 #ca5a51 #dc6d65 #df8982 #e8aaa5 #e52d3f #ff8278 #f1847c #ee918a",
    "var(--warning)": "#f1b51e",
}
for token, values in HEX.items():
    for value in values.split():
        css = re.sub(re.escape(value) + r"\b", token, css, flags=re.I)

open(path, "w", encoding="utf-8").write(css)
