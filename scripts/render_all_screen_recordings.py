import os
import sys
import math
import subprocess

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

from PIL import Image, ImageDraw, ImageFont

AUDIO_DIR = r"C:\Users\Dhrubo\Desktop\ex video\temp_audio"
OUTPUT_DIR = r"C:\Users\Dhrubo\Desktop\ex video"
MASCOT_PATH = r"C:\Users\Dhrubo\.gemini\antigravity\brain\e51ffb51-0a9c-4e6d-aed7-44a81aa84403\sahkarmi_mascot_deepcheck_1792606802712.jpg"
ICON_PATH = r"C:\Users\Dhrubo\projects\sahakarmi-release\build\icon.png"

WIDTH = 1080
HEIGHT = 1920
FPS = 30

# Load Fonts
def load_font(name, size):
    path = os.path.join(r"C:\Windows\Fonts", name)
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

font_header_tag = load_font("segoeuib.ttf", 22)
font_header_title = load_font("segoeuib.ttf", 46)
font_header_sub = load_font("segoeui.ttf", 24)

font_win_title = load_font("segoeuib.ttf", 22)
font_win_status = load_font("segoeuib.ttf", 18)

font_ui_bold = load_font("segoeuib.ttf", 26)
font_ui_reg = load_font("segoeui.ttf", 22)
font_ui_sm = load_font("segoeui.ttf", 18)
font_ui_xs = load_font("segoeui.ttf", 16)

font_code = load_font("consola.ttf", 20)
font_code_bold = load_font("consolab.ttf", 22)

font_sub_highlight = load_font("segoeuib.ttf", 36)
font_sub_norm = load_font("segoeui.ttf", 30)

font_cta = load_font("segoeuib.ttf", 28)

# Load Mascot thumbnail if available
mascot_thumb = None
if os.path.exists(MASCOT_PATH):
    try:
        m_img = Image.open(MASCOT_PATH).convert("RGBA")
        m_img = m_img.resize((120, 120), Image.Resampling.LANCZOS)
        # Circular mask
        mask = Image.new("L", (120, 120), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.ellipse((0, 0, 120, 120), fill=255)
        m_img.putalpha(mask)
        mascot_thumb = m_img
    except Exception as e:
        print("Mascot load notice:", e)

# Helper drawing routines
def draw_cursor(draw, x, y, click_val=0.0):
    # Sleek arrow cursor
    pts = [
        (x, y),
        (x, y + 26),
        (x + 7, y + 20),
        (x + 16, y + 29),
        (x + 20, y + 25),
        (x + 11, y + 17),
        (x + 20, y + 17)
    ]
    # Shadow
    s_pts = [(px + 2, py + 2) for px, py in pts]
    draw.polygon(s_pts, fill=(0, 0, 0, 160))
    # Body
    draw.polygon(pts, fill=(255, 255, 255, 255), outline=(20, 20, 20, 255))
    
    # Click ripple
    if click_val > 0.0:
        r = int(12 + click_val * 28)
        alpha = int((1.0 - click_val) * 255)
        draw.ellipse([x - r, y - r, x + r, y + r], outline=(234, 88, 12, alpha), width=3)

def draw_window_chrome(draw, x, y, w, h, title, status_text="AI AGENT ACTIVE", status_color=(34, 197, 94)):
    # Outer frame
    draw.rounded_rectangle([x, y, x + w, y + h], radius=16, fill=(15, 23, 42), outline=(51, 65, 85), width=2)
    # Header bar
    draw.rounded_rectangle([x, y, x + w, y + 54], radius=16, fill=(30, 41, 59))
    draw.rectangle([x, y + 36, x + w, y + 54], fill=(30, 41, 59)) # square bottom corners
    draw.line([x, y + 54, x + w, y + 54], fill=(51, 65, 85), width=2)
    
    # Traffic dots
    draw.ellipse([x + 20, y + 19, x + 34, y + 33], fill=(239, 68, 68))
    draw.ellipse([x + 44, y + 19, x + 58, y + 33], fill=(245, 158, 11))
    draw.ellipse([x + 68, y + 19, x + 82, y + 33], fill=(34, 197, 94))
    
    # Title
    draw.text((x + 106, y + 15), title, fill=(226, 232, 240), font=font_win_title)
    
    # Status pill
    draw.rounded_rectangle([x + w - 210, y + 12, x + w - 18, y + 42], radius=12, fill=(15, 23, 42), outline=(51, 65, 85), width=1)
    draw.ellipse([x + w - 198, y + 23, x + w - 188, y + 33], fill=status_color)
    draw.text((x + w - 180, y + 16), status_text, fill=(203, 213, 225), font=font_win_status)

def draw_header_banner(draw, tag, title, subtitle):
    # Background gradient or dark canvas
    draw.rounded_rectangle([50, 40, 360, 80], radius=20, fill=(30, 41, 59), outline=(234, 88, 12), width=2)
    draw.text((70, 48), tag, fill=(249, 115, 22), font=font_header_tag)
    
    # Title
    draw.text((50, 96), title, fill=(255, 255, 255), font=font_header_title)
    # Subtitle
    draw.text((50, 160), subtitle, fill=(148, 163, 184), font=font_header_sub)

def draw_subtitles_card(draw, text_highlight, text_full, p):
    # Bottom captions card
    card_y = 1580
    draw.rounded_rectangle([50, card_y, 1030, card_y + 180], radius=18, fill=(15, 23, 42), outline=(234, 88, 12), width=2)
    
    # Speaker indicator
    draw.ellipse([75, card_y + 24, 91, card_y + 40], fill=(234, 88, 12))
    draw.text((102, card_y + 20), "SAHKARMI AI (NEERJA) • LIVE NARRATION", fill=(249, 115, 22), font=font_ui_xs)
    
    # Highlighted voice text
    draw.text((75, card_y + 55), text_highlight, fill=(253, 224, 71), font=font_sub_highlight)
    
    # Full sentence text
    draw.text((75, card_y + 115), text_full, fill=(226, 232, 240), font=font_sub_norm)

def draw_cta_footer(draw):
    foot_y = 1810
    draw.rounded_rectangle([50, foot_y, 1030, foot_y + 70], radius=16, fill=(234, 88, 12))
    draw.text((210, foot_y + 18), "⚡ Download Sahkarmi for Windows & Mac • sahkarmi.ai", fill=(255, 255, 255), font=font_cta)


# ==============================================================================
# SCENE 1: WHATSAPP WEB OUTREACH
# ==============================================================================
def render_frame_whatsapp(t, total_t):
    img = Image.new("RGB", (WIDTH, HEIGHT), (11, 15, 25))
    draw = ImageDraw.Draw(img)
    p = t / total_t
    
    draw_header_banner(draw, "🟢 USE CASE 01 / 07", "WHATSAPP WEB AI OUTREACH", "Autonomous Lead Responses, Catalog Sharing & Order Closing")
    
    wx, wy, ww, wh = 50, 220, 980, 1320
    draw_window_chrome(draw, wx, wy, ww, wh, "WhatsApp Web — Sahkarmi Lead Engine v0.5.5")
    
    # WhatsApp Web Layout
    # Left Sidebar (Chats)
    sb_w = 340
    draw.rectangle([wx + 2, wy + 56, wx + sb_w, wy + wh - 2], fill=(17, 27, 33))
    draw.line([wx + sb_w, wy + 56, wx + sb_w, wy + wh - 2], fill=(34, 46, 53), width=2)
    
    # Sidebar Search
    draw.rounded_rectangle([wx + 15, wy + 72, wx + sb_w - 15, wy + 112], radius=10, fill=(32, 44, 51))
    draw.text((wx + 35, wy + 82), "🔍 Search or start new chat", fill=(134, 150, 160), font=font_ui_sm)
    
    # Chat Rows
    chats = [
        ("Rahul Sharma (Lead #5821)", "Do you have 50 units in stock?", "10:42 AM", True),
        ("Pooja Gupta (Fashion Hub)", "Catalog received! Placing order", "10:38 AM", False),
        ("Amit Wholesale Corp", "Please send GST invoice copy", "09:55 AM", False),
        ("Sneha Tech Solutions", "Can we schedule a demo call?", "Yesterday", False),
        ("Vikram Builders", "Thanks, received quotation", "Monday", False)
    ]
    
    for i, (name, preview, time_str, is_active) in enumerate(chats):
        cy = wy + 130 + i * 90
        if is_active:
            draw.rectangle([wx + 2, cy - 8, wx + sb_w, cy + 78], fill=(42, 57, 66))
        
        # Avatar
        draw.ellipse([wx + 16, cy, wx + 68, cy + 52], fill=(0, 168, 132) if is_active else (55, 65, 81))
        initials = "".join([part[0] for part in name.split()[:2]])
        draw.text((wx + 28, cy + 14), initials, fill=(255, 255, 255), font=font_ui_bold)
        
        # Name & Time
        draw.text((wx + 80, cy + 6), name[:22], fill=(233, 237, 239) if is_active else (209, 213, 219), font=font_ui_bold)
        draw.text((wx + sb_w - 75, cy + 8), time_str, fill=(0, 168, 132) if is_active else (134, 150, 160), font=font_ui_xs)
        
        # Preview
        draw.text((wx + 80, cy + 34), preview[:26] + "...", fill=(134, 150, 160), font=font_ui_sm)
        if is_active:
            # Unread badge
            draw.ellipse([wx + sb_w - 38, cy + 34, wx + sb_w - 18, cy + 54], fill=(0, 168, 132))
            draw.text((wx + sb_w - 32, cy + 36), "1", fill=(17, 27, 33), font=font_ui_xs)
            
    # Right Chat Area
    rx = wx + sb_w + 2
    rw = ww - sb_w - 4
    draw.rectangle([rx, wy + 56, wx + ww - 2, wy + wh - 2], fill=(11, 20, 26))
    
    # Top Chat Header
    draw.rectangle([rx, wy + 56, wx + ww - 2, wy + 126], fill=(32, 44, 51))
    draw.ellipse([rx + 20, wy + 68, rx + 68, wy + 116], fill=(0, 168, 132))
    draw.text((rx + 32, wy + 80), "RS", fill=(255, 255, 255), font=font_ui_bold)
    draw.text((rx + 82, wy + 72), "Rahul Sharma (Lead #5821)", fill=(233, 237, 239), font=font_ui_bold)
    draw.text((rx + 82, wy + 100), "🟢 Online • Auto-Monitored by Sahkarmi", fill=(0, 168, 132), font=font_ui_xs)
    
    # Messages in Chat
    # Message 1: Incoming Lead
    draw.rounded_rectangle([rx + 30, wy + 160, rx + 520, wy + 260], radius=12, fill=(32, 44, 51))
    draw.text((rx + 50, wy + 175), "Hi, I saw your product online.", fill=(233, 237, 239), font=font_ui_reg)
    draw.text((rx + 50, wy + 205), "Do you have 50 units in stock?", fill=(233, 237, 239), font=font_ui_reg)
    draw.text((rx + 440, wy + 235), "10:41 AM", fill=(134, 150, 160), font=font_ui_xs)
    
    # Sahkarmi Agent Analysis Toast
    if p > 0.15:
        draw.rounded_rectangle([rx + 40, wy + 290, rx + 580, wy + 350], radius=10, fill=(30, 41, 59), outline=(0, 168, 132), width=1)
        draw.text((rx + 60, wy + 306), "⚡ Sahkarmi 'Vikram' matched catalog & draft response", fill=(52, 211, 153), font=font_ui_sm)
    
    # Dynamic Typing in Input Bar or Sent Message
    input_text = "Namaste Rahul ji! 50 units in stock with 15% discount. Here is your catalog & invoice link:"
    
    if p < 0.45:
        # Typing in bottom input box
        typed_len = int(len(input_text) * min(1.0, (p - 0.18) / 0.22)) if p >= 0.18 else 0
        current_typed = input_text[:typed_len]
        
        # Input Bar
        draw.rounded_rectangle([rx + 20, wy + wh - 110, rx + rw - 80, wy + wh - 40], radius=12, fill=(42, 57, 66))
        draw.text((rx + 40, wy + wh - 92), current_typed + ("|" if int(t * 4) % 2 == 0 else ""), fill=(233, 237, 239), font=font_ui_reg)
        
        # Send Button
        draw.ellipse([rx + rw - 65, wy + wh - 105, rx + rw - 25, wy + wh - 65], fill=(0, 168, 132))
        draw.polygon([(rx + rw - 50, wy + wh - 95), (rx + rw - 40, wy + wh - 85), (rx + rw - 50, wy + wh - 75)], fill=(17, 27, 33))
    else:
        # Message is SENT and visible in chat!
        draw.rounded_rectangle([rx + 110, wy + 380, rx + rw - 30, wy + 540], radius=12, fill=(0, 92, 75))
        draw.text((rx + 130, wy + 395), "Namaste Rahul ji! 50 units in stock with 15% discount.", fill=(233, 237, 239), font=font_ui_reg)
        draw.text((rx + 130, wy + 425), "Here is your catalog & instant invoice link:", fill=(233, 237, 239), font=font_ui_reg)
        draw.text((rx + 130, wy + 460), "🔗 sahkarmi.ai/catalog/order_5821", fill=(147, 197, 253), font=font_ui_reg)
        draw.text((rx + rw - 130, wy + 510), "10:42 AM  ✓✓", fill=(52, 211, 153), font=font_ui_sm)
        
        # Catalog Preview Card
        draw.rounded_rectangle([rx + 110, wy + 560, rx + rw - 30, wy + 760], radius=14, fill=(32, 44, 51), outline=(0, 168, 132), width=2)
        draw.rectangle([rx + 110, wy + 560, rx + rw - 30, wy + 620], fill=(42, 57, 66))
        draw.text((rx + 140, wy + 580), "📦 WHOLESALE INVENTORY CATALOG 2026", fill=(249, 115, 22), font=font_ui_bold)
        draw.text((rx + 140, wy + 640), "• 50 Units Reserved: Smart POS Hardware", fill=(233, 237, 239), font=font_ui_reg)
        draw.text((rx + 140, wy + 675), "• Total Amount: ₹45,280 (18% GST Included)", fill=(52, 211, 153), font=font_ui_bold)
        draw.text((rx + 140, wy + 715), "• Delivery: Express Courier to Bangalore (24 Hrs)", fill=(148, 163, 184), font=font_ui_sm)
        
        if p > 0.65:
            # Customer Reply
            draw.rounded_rectangle([rx + 30, wy + 790, rx + 520, wy + 870], radius=12, fill=(32, 44, 51))
            draw.text((rx + 50, wy + 805), "Awesome! Please dispatch to Bangalore.", fill=(233, 237, 239), font=font_ui_reg)
            draw.text((rx + 440, wy + 840), "10:43 AM", fill=(134, 150, 160), font=font_ui_xs)
            
            # Status Badge Confirmation
            draw.rounded_rectangle([rx + 60, wy + 900, rx + rw - 60, wy + 980], radius=14, fill=(16, 185, 129), outline=(255, 255, 255), width=2)
            draw.text((rx + 100, wy + 925), "✅ ORDER #5821 CONFIRMED • DISPATCH SCHEDULED", fill=(255, 255, 255), font=font_ui_bold)
            
        # Empty input box waiting for next command
        draw.rounded_rectangle([rx + 20, wy + wh - 110, rx + rw - 80, wy + wh - 40], radius=12, fill=(42, 57, 66))
        draw.text((rx + 40, wy + wh - 92), "Type a message...", fill=(134, 150, 160), font=font_ui_reg)
        draw.ellipse([rx + rw - 65, wy + wh - 105, rx + rw - 25, wy + wh - 65], fill=(0, 168, 132))
        draw.polygon([(rx + rw - 50, wy + wh - 95), (rx + rw - 40, wy + wh - 85), (rx + rw - 50, wy + wh - 75)], fill=(17, 27, 33))

    # Mascot avatar badge inside window
    if mascot_thumb:
        img.paste(mascot_thumb, (wx + ww - 140, wy + wh - 220), mascot_thumb)
        
    # Animate Mouse Cursor
    # Path: Moves to chat (0-15%), moves to input (15-35%), clicks send (40-45%), moves to catalog (55-80%)
    click_pulse = 0.0
    if p < 0.15:
        cx = wx + 120 + int(p / 0.15 * 80)
        cy = wy + 160
    elif p < 0.42:
        cx = rx + 80 + int((p - 0.15) / 0.27 * (rw - 180))
        cy = wy + wh - 75
    elif p < 0.50:
        cx = rx + rw - 45
        cy = wy + wh - 85
        click_pulse = (p - 0.42) / 0.08
    else:
        cx = rx + 300 + int(math.sin(t * 2) * 40)
        cy = wy + 620 + int(math.cos(t * 2) * 20)
        
    draw_cursor(draw, cx, cy, click_pulse)
    
    # Subtitles synchronized with voiceover
    if p < 0.20:
        draw_subtitles_card(draw, "Want to automate WhatsApp outreach? Watch this.", "Sahkarmi AI opens WhatsApp Web directly on your PC.", p)
    elif p < 0.48:
        draw_subtitles_card(draw, "Scans unread leads & drafts Hindi/English messages.", "Reads intent from chats and prepares personalized quotes.", p)
    elif p < 0.75:
        draw_subtitles_card(draw, "Shares catalog, answers queries & closes orders 24/7.", "Direct wholesale links, pricing calculations, zero delays.", p)
    else:
        draw_subtitles_card(draw, "Zero manual work. Download Sahkarmi today!", "Run your entire customer outreach autonomously on desktop.", p)
        
    draw_cta_footer(draw)
    return img


# ==============================================================================
# SCENE 2: SOCIAL MEDIA PLATFORM MANAGER
# ==============================================================================
def render_frame_social(t, total_t):
    img = Image.new("RGB", (WIDTH, HEIGHT), (11, 15, 25))
    draw = ImageDraw.Draw(img)
    p = t / total_t
    
    draw_header_banner(draw, "⚡ USE CASE 02 / 07", "SOCIAL MEDIA MANAGER", "Omnichannel Auto-Posting, Viral Hooks & Instant DM Conversions")
    
    wx, wy, ww, wh = 50, 220, 980, 1320
    draw_window_chrome(draw, wx, wy, ww, wh, "Sahkarmi Social Suite — Multi-Network Studio")
    
    # Left Navigation Sidebar
    nav_w = 260
    draw.rectangle([wx + 2, wy + 56, wx + nav_w, wy + wh - 2], fill=(15, 23, 42))
    draw.line([wx + nav_w, wy + 56, wx + nav_w, wy + wh - 2], fill=(30, 41, 59), width=2)
    
    nav_items = [
        ("🚀 Post Studio", True),
        ("📅 Content Calendar", False),
        ("💬 Inbound DMs (4)", False),
        ("📈 Viral Trend Radar", False),
        ("⚙️ Connected Accounts", False)
    ]
    for i, (item, active) in enumerate(nav_items):
        ny = wy + 90 + i * 65
        if active:
            draw.rounded_rectangle([wx + 15, ny, wx + nav_w - 15, ny + 48], radius=10, fill=(234, 88, 12))
            draw.text((wx + 30, ny + 12), item, fill=(255, 255, 255), font=font_ui_bold)
        else:
            draw.text((wx + 30, ny + 12), item, fill=(148, 163, 184), font=font_ui_reg)
            
    # Main Studio Pane
    mx = wx + nav_w + 20
    mw = ww - nav_w - 40
    
    # Platform Checkbox Bar
    draw.text((mx, wy + 80), "Select Publishing Channels:", fill=(203, 213, 225), font=font_ui_bold)
    channels = [("LinkedIn", True, (10, 102, 194)), ("X / Twitter", True, (0, 0, 0)), ("Instagram", True, (225, 48, 108)), ("Threads", True, (30, 41, 59))]
    for i, (ch_name, ch_active, ch_col) in enumerate(channels):
        cx = mx + i * 165
        draw.rounded_rectangle([cx, wy + 120, cx + 150, wy + 165], radius=10, fill=ch_col if ch_active else (30, 41, 59), outline=(255, 255, 255, 60), width=1)
        draw.text((cx + 20, wy + 130), f"✓ {ch_name}", fill=(255, 255, 255), font=font_ui_sm)
        
    # Post Editor Card
    draw.rounded_rectangle([mx, wy + 190, mx + mw, wy + 620], radius=14, fill=(30, 41, 59), outline=(51, 65, 85), width=2)
    draw.text((mx + 25, wy + 210), "AI Content Generation — Peak Engagement Formula", fill=(249, 115, 22), font=font_ui_bold)
    
    post_text_full = (
        "Most founders spend 3+ hours daily answering repetitive customer queries.\n\n"
        "Here is the exact automation playbook we built using Sahkarmi AI coworkers:\n"
        "1. Real-time lead qualification from incoming messages\n"
        "2. Automated invoice extraction & reconciliation\n"
        "3. Multi-agent code reviews directly on your local PC\n\n"
        "#StartupIndia #AIAutomation #ProductivityBoost"
    )
    
    typed_chars = int(len(post_text_full) * min(1.0, (p / 0.45))) if p > 0.10 else 0
    curr_text = post_text_full[:typed_chars]
    
    # Draw text lines
    lines = curr_text.split("\n")
    ly = wy + 260
    for line in lines:
        draw.text((mx + 25, ly), line, fill=(241, 245, 249), font=font_ui_sm)
        ly += 30
    if p <= 0.45 and int(t * 4) % 2 == 0:
        draw.rectangle([mx + 25 + len(lines[-1]) * 10, ly - 30, mx + 27 + len(lines[-1]) * 10, ly - 8], fill=(249, 115, 22))
        
    # Engagement Prediction Badge
    if p > 0.35:
        draw.rounded_rectangle([mx, wy + 645, mx + mw, wy + 725], radius=12, fill=(15, 23, 42), outline=(34, 197, 94), width=1)
        draw.text((mx + 25, wy + 660), "🔥 VIRAL PREDICTION SCORE: 94 / 100", fill=(34, 197, 94), font=font_ui_bold)
        draw.text((mx + 25, wy + 692), "Optimal Time: 06:00 PM IST • Expected Impressions: 42,000+", fill=(148, 163, 184), font=font_ui_sm)
        
    # Schedule Button
    btn_y = wy + 750
    btn_col = (34, 197, 94) if p > 0.55 else (234, 88, 12)
    btn_text = "✓ POST SCHEDULED FOR 6:00 PM (ALL CHANNELS)" if p > 0.55 else "⚡ SCHEDULE OMNICHANNEL POST"
    draw.rounded_rectangle([mx, btn_y, mx + mw, btn_y + 60], radius=12, fill=btn_col)
    draw.text((mx + 80, btn_y + 16), btn_text, fill=(255, 255, 255), font=font_ui_bold)
    
    # Inbound DM Alert Card (slid in from bottom)
    if p > 0.65:
        dm_y = wy + 840
        draw.rounded_rectangle([mx, dm_y, mx + mw, dm_y + 240], radius=14, fill=(24, 24, 27), outline=(234, 88, 12), width=2)
        draw.rectangle([mx, dm_y, mx + mw, dm_y + 50], fill=(39, 39, 42))
        draw.text((mx + 20, dm_y + 14), "💬 INBOUND DM AUTO-CONVERTED • INSTAGRAM", fill=(249, 115, 22), font=font_ui_bold)
        
        draw.text((mx + 20, dm_y + 70), "Prospect @priya_tech: 'Interested! Can I book a demo call?'", fill=(228, 228, 231), font=font_ui_sm)
        draw.rounded_rectangle([mx + 20, dm_y + 110, mx + mw - 20, dm_y + 180], radius=10, fill=(30, 41, 59))
        draw.text((mx + 40, dm_y + 125), "🤖 Sahkarmi AI: 'Namaste Priya! Book a 15-min walkthrough here:'", fill=(52, 211, 153), font=font_ui_sm)
        draw.text((mx + 40, dm_y + 152), "calendly.com/sahkarmi-demo • Demo slot locked!", fill=(147, 197, 253), font=font_ui_sm)
        
        draw.text((mx + 20, dm_y + 200), "✓ Lead added to CRM • Zero human intervention needed", fill=(34, 197, 94), font=font_ui_xs)

    # Mascot avatar badge
    if mascot_thumb:
        img.paste(mascot_thumb, (wx + ww - 140, wy + wh - 200), mascot_thumb)

    # Animated Cursor
    click_pulse = 0.0
    if p < 0.45:
        cx = mx + 200 + int(p * 200)
        cy = wy + 350
    elif p < 0.60:
        cx = mx + mw // 2
        cy = btn_y + 30
        click_pulse = (p - 0.50) / 0.10 if p >= 0.50 else 0.0
    else:
        cx = mx + mw // 2 + int(math.sin(t * 3) * 30)
        cy = wy + 940
        
    draw_cursor(draw, cx, cy, click_pulse)
    
    # Subtitles
    if p < 0.22:
        draw_subtitles_card(draw, "Managing multiple social accounts is exhausting.", "Let your Sahkarmi AI coworker take over full control.", p)
    elif p < 0.50:
        draw_subtitles_card(draw, "Auto-writes high converting posts across 4 platforms.", "Monitors trends on LinkedIn, X, Instagram and schedules posts.", p)
    elif p < 0.75:
        draw_subtitles_card(draw, "Schedules at peak hours & replies to DMs instantly.", "Turns comments and DMs into confirmed demo calls automatically.", p)
    else:
        draw_subtitles_card(draw, "Deploy your social media agent with Sahkarmi!", "Grow your brand hands-free on your desktop today.", p)
        
    draw_cta_footer(draw)
    return img


# ==============================================================================
# SCENE 3: FULL SOFTWARE DEV TEAM (8 AGENTS)
# ==============================================================================
def render_frame_software(t, total_t):
    img = Image.new("RGB", (WIDTH, HEIGHT), (11, 15, 25))
    draw = ImageDraw.Draw(img)
    p = t / total_t
    
    draw_header_banner(draw, "⚡ USE CASE 03 / 07", "FULL SOFTWARE DEV TEAM", "8 Specialist AI Agents Collaborating in an Autonomous DAG")
    
    wx, wy, ww, wh = 50, 220, 980, 1320
    draw_window_chrome(draw, wx, wy, ww, wh, "Sahkarmi Studio — Multi-Agent IDE & Terminal", "8 AGENTS ACTIVE", (99, 102, 241))
    
    # Left File Explorer
    ex_w = 220
    draw.rectangle([wx + 2, wy + 56, wx + ex_w, wy + wh - 2], fill=(24, 24, 27))
    draw.line([wx + ex_w, wy + 56, wx + ex_w, wy + wh - 2], fill=(39, 39, 42), width=2)
    
    draw.text((wx + 15, wy + 75), "EXPLORER: SAHKARMI", fill=(161, 161, 170), font=font_ui_xs)
    files = [
        ("📁 src/agents", True),
        ("  📄 mitra_coord.ts", False),
        ("  📄 dev_coder.ts", True),
        ("  📄 qa_kabir.ts", False),
        ("📁 tests", False),
        ("  📄 e2e_dag.test.ts", False),
        ("📄 package.json", False),
        ("📄 Cargo.toml", False)
    ]
    for i, (fn, active) in enumerate(files):
        fy = wy + 110 + i * 36
        draw.text((wx + 20, fy), fn, fill=(249, 115, 22) if active else (212, 212, 216), font=font_ui_sm)
        
    # Code Editor Center
    cx = wx + ex_w + 10
    cw = ww - ex_w - 20
    
    # Code Tabs
    draw.rectangle([cx, wy + 56, cx + cw, wy + 98], fill=(30, 41, 59))
    draw.rectangle([cx, wy + 56, cx + 200, wy + 98], fill=(15, 23, 42))
    draw.text((cx + 20, wy + 68), "📄 dev_coder.ts", fill=(255, 255, 255), font=font_ui_sm)
    
    # Code Editor Body
    draw.rectangle([cx, wy + 98, cx + cw, wy + 560], fill=(15, 23, 42))
    
    code_lines = [
        ("import { DAG, AgentCoordinator } from '@sahkarmi/core';", (147, 197, 253)),
        ("import { Mitra, Dev, Kabir, Sneha } from './agents';", (147, 197, 253)),
        ("", (255, 255, 255)),
        ("// Autonomous Multi-Agent Pipeline", (100, 116, 139)),
        ("export async function executeSprintDAG(spec: FeaturePRD) {", (249, 115, 22)),
        ("  const arch = await Mitra.decomposeSpec(spec);", (226, 232, 240)),
        ("  const code = await Dev.generateCodebase(arch);", (226, 232, 240)),
        ("  const qaResult = await Kabir.runEdgeCaseSuite(code);", (226, 232, 240)),
        ("  if (!qaResult.allGreen) throw new SafetyBoundaryError();", (239, 68, 68)),
        ("  return await Sneha.publishProductionRelease(code);", (52, 211, 153)),
        ("}", (249, 115, 22))
    ]
    
    max_code_line = int(len(code_lines) * min(1.0, (p / 0.40))) if p > 0.08 else 2
    for idx, (cline, ccolor) in enumerate(code_lines[:max_code_line]):
        ly = wy + 115 + idx * 36
        draw.text((cx + 15, ly), f"{idx+1:2d}  {cline}", fill=ccolor, font=font_code)
        
    # Multi-Agent DAG Visualizer Card
    dag_y = wy + 580
    draw.rounded_rectangle([cx, dag_y, cx + cw, dag_y + 180], radius=12, fill=(24, 24, 27), outline=(99, 102, 241), width=2)
    draw.text((cx + 20, dag_y + 15), "⚡ MULTI-AGENT DAG WORKFLOW (LIVE EXECUTION)", fill=(165, 180, 252), font=font_ui_bold)
    
    nodes = [
        ("Mitra (Arch)", "DONE", (34, 197, 94)),
        ("Dev (Coding)", "DONE" if p > 0.35 else "ACTIVE", (34, 197, 94) if p > 0.35 else (234, 88, 12)),
        ("Kabir (QA)", "DONE" if p > 0.60 else ("TESTING" if p > 0.35 else "WAITING"), (34, 197, 94) if p > 0.60 else (245, 158, 11)),
        ("Sneha (Release)", "DEPLOYED" if p > 0.75 else ("PACKAGING" if p > 0.60 else "WAITING"), (52, 211, 153) if p > 0.75 else (148, 163, 184))
    ]
    for i, (node_name, status, status_col) in enumerate(nodes):
        nx = cx + 20 + i * 175
        draw.rounded_rectangle([nx, dag_y + 60, nx + 155, dag_y + 140], radius=10, fill=(39, 39, 42), outline=status_col, width=2)
        draw.text((nx + 15, dag_y + 75), node_name, fill=(255, 255, 255), font=font_ui_sm)
        draw.text((nx + 15, dag_y + 105), status, fill=status_col, font=font_ui_bold)
        if i < 3:
            draw.text((nx + 160, dag_y + 90), "➔", fill=(99, 102, 241), font=font_ui_bold)
            
    # Bottom Terminal
    term_y = wy + 780
    term_h = wh - 800
    draw.rectangle([cx, term_y, cx + cw, wy + wh - 2], fill=(10, 10, 10))
    draw.line([cx, term_y, cx + cw, term_y], fill=(39, 39, 42), width=2)
    
    draw.text((cx + 15, term_y + 12), "TERMINAL: powershell (bun test & deploy)", fill=(161, 161, 170), font=font_ui_xs)
    
    term_logs = [
        ("$ bun test --run test/e2e_dag.test.ts", (226, 232, 240)),
        ("  (pass) Mitra spec decomposition [12ms]", (34, 197, 94)),
        ("  (pass) Dev clean code generation [48ms]", (34, 197, 94)),
        ("  (pass) Kabir edge-case fuzzing: 0 memory leaks [32ms]", (34, 197, 94)),
        ("  (pass) Sneha packaging binary: Sahkarmi-0.5.5-x64.exe [85ms]", (34, 197, 94)),
        ("✨ 68 test suites passed! (100% green, 0 errors)", (52, 211, 153)),
        ("🚀 Production release v0.5.5 successfully published to GitHub!", (250, 204, 21))
    ]
    
    max_term = int(len(term_logs) * min(1.0, ((p - 0.25) / 0.50))) if p > 0.25 else 1
    for idx, (tline, tcol) in enumerate(term_logs[:max_term]):
        draw.text((cx + 15, term_y + 45 + idx * 34), tline, fill=tcol, font=font_code)

    # Mascot avatar badge
    if mascot_thumb:
        img.paste(mascot_thumb, (wx + ww - 140, wy + wh - 200), mascot_thumb)

    # Animated Cursor
    click_pulse = 0.0
    if p < 0.35:
        cx_cur = cx + 280
        cy_cur = wy + 240 + int(p * 200)
    elif p < 0.65:
        cx_cur = cx + 450
        cy_cur = dag_y + 100
        click_pulse = (p - 0.55) / 0.10 if p >= 0.55 else 0.0
    else:
        cx_cur = cx + 320
        cy_cur = term_y + 180
        
    draw_cursor(draw, cx_cur, cy_cur, click_pulse)
    
    # Subtitles
    if p < 0.22:
        draw_subtitles_card(draw, "Need an entire software dev team on your desktop?", "Sahkarmi deploys 8 specialist AI agents working together.", p)
    elif p < 0.50:
        draw_subtitles_card(draw, "From system architecture to backend APIs & testing.", "Mitra, Dev, Kabir and Sneha collaborate without human loops.", p)
    elif p < 0.75:
        draw_subtitles_card(draw, "Clean, production-ready code with 100% passing tests.", "Automated edge-case verification, git commits and builds.", p)
    else:
        draw_subtitles_card(draw, "Build faster with Sahkarmi today!", "Your private AI engineering squad directly on your computer.", p)
        
    draw_cta_footer(draw)
    return img


# ==============================================================================
# SCENE 4: AUTONOMOUS VIDEO PRODUCER
# ==============================================================================
def render_frame_video(t, total_t):
    img = Image.new("RGB", (WIDTH, HEIGHT), (11, 15, 25))
    draw = ImageDraw.Draw(img)
    p = t / total_t
    
    draw_header_banner(draw, "⚡ USE CASE 04 / 07", "AUTONOMOUS VIDEO PRODUCER", "Raw Webinar & Podcast Ingest to 9:16 Viral Reels with Kinetic Captions")
    
    wx, wy, ww, wh = 50, 220, 980, 1320
    draw_window_chrome(draw, wx, wy, ww, wh, "Sahkarmi Video Studio — Auto Reel Engine", "RENDERING 60 FPS", (236, 72, 153))
    
    # Center Mobile Phone Video Preview Frame (9:16 portrait in the studio)
    phone_w = 400
    phone_h = 700
    px = wx + (ww - phone_w) // 2
    py = wy + 70
    
    # Phone border
    draw.rounded_rectangle([px, py, px + phone_w, py + phone_h], radius=24, fill=(15, 23, 42), outline=(236, 72, 153), width=3)
    
    # Video preview contents inside phone
    # Simulated podcast / speaker background
    draw.rectangle([px + 10, py + 10, px + phone_w - 10, py + phone_h - 10], fill=(24, 24, 27))
    
    # Speaker silhouette / video graphic
    draw.ellipse([px + 120, py + 120, px + 280, py + 280], fill=(234, 88, 12))
    draw.ellipse([px + 150, py + 150, px + 250, py + 250], fill=(255, 255, 255))
    draw.text((px + 180, py + 185), "🎙️", fill=(0, 0, 0), font=font_ui_bold)
    
    # Audio Waveform visualizer bars bouncing
    wave_y = py + 340
    for b in range(24):
        bx = px + 40 + b * 13
        h_bar = int(15 + 40 * math.sin(t * 8 + b * 0.5) ** 2)
        draw.rounded_rectangle([bx, wave_y - h_bar, bx + 8, wave_y + h_bar], radius=4, fill=(236, 72, 153))
        
    # Kinetic Animated Subtitles on the Video
    subtitle_lines = [
        "TURN LONG-FORM VIDEOS",
        "INTO VIRAL REELS",
        "EFFORTLESSLY!"
    ]
    curr_sub_idx = min(2, int(p * 3.5))
    draw.rounded_rectangle([px + 30, py + 480, px + phone_w - 30, py + 570], radius=12, fill=(0, 0, 0, 200), outline=(253, 224, 71), width=2)
    draw.text((px + 50, py + 505), subtitle_lines[curr_sub_idx], fill=(253, 224, 71), font=font_ui_bold)
    
    # Export status overlay inside preview
    if p > 0.70:
        draw.rounded_rectangle([px + 40, py + 220, px + phone_w - 40, py + 320], radius=16, fill=(16, 185, 129), outline=(255, 255, 255), width=2)
        draw.text((px + 65, py + 245), "✓ EXPORT 100% COMPLETE", fill=(255, 255, 255), font=font_ui_bold)
        draw.text((px + 80, py + 280), "Saved to Desktop / ex video", fill=(241, 245, 249), font=font_ui_sm)
        
    # Multi-Track Timeline at Bottom of Studio Window
    tl_y = wy + 810
    tl_h = wh - 830
    draw.rectangle([wx + 2, tl_y, wx + ww - 2, wy + wh - 2], fill=(20, 20, 25))
    draw.line([wx + 2, tl_y, wx + ww - 2, tl_y], fill=(39, 39, 42), width=2)
    
    # Timeline Tracks
    tracks = [
        ("V1: Video Reframe", (147, 51, 234)),
        ("A1: Neerja Voice", (59, 130, 246)),
        ("T1: Kinetic Captions", (234, 179, 8)),
        ("B1: Sound Effects", (16, 185, 129))
    ]
    for idx, (tname, tcol) in enumerate(tracks):
        try_y = tl_y + 20 + idx * 75
        draw.text((wx + 20, try_y + 15), tname, fill=(203, 213, 225), font=font_ui_sm)
        
        # Track clip bar
        draw.rounded_rectangle([wx + 220, try_y, wx + ww - 30, try_y + 55], radius=8, fill=tcol)
        # Slices
        draw.line([wx + 450, try_y, wx + 450, try_y + 55], fill=(0, 0, 0), width=2)
        draw.line([wx + 720, try_y, wx + 720, try_y + 55], fill=(0, 0, 0), width=2)
        
    # Red Playhead
    playhead_x = wx + 220 + int(p * (ww - 250))
    draw.line([playhead_x, tl_y, playhead_x, wy + wh - 2], fill=(239, 68, 68), width=3)
    draw.polygon([(playhead_x - 10, tl_y), (playhead_x + 10, tl_y), (playhead_x, tl_y + 15)], fill=(239, 68, 68))

    # Mascot avatar badge
    if mascot_thumb:
        img.paste(mascot_thumb, (wx + ww - 140, wy + wh - 200), mascot_thumb)

    # Animated Cursor
    click_pulse = 0.0
    if p < 0.50:
        cx_cur = px + 150 + int(p * 200)
        cy_cur = py + 300
    elif p < 0.75:
        cx_cur = wx + ww - 120
        cy_cur = wy + 150
        click_pulse = (p - 0.65) / 0.10 if p >= 0.65 else 0.0
    else:
        cx_cur = playhead_x
        cy_cur = tl_y + 100
        
    draw_cursor(draw, cx_cur, cy_cur, click_pulse)
    
    # Subtitles
    if p < 0.22:
        draw_subtitles_card(draw, "Turn long-form videos into viral mobile reels.", "Sahkarmi AI extracts high-engagement hooks automatically.", p)
    elif p < 0.50:
        draw_subtitles_card(draw, "Auto crops to 9:16 portrait format & syncs audio.", "Identifies emotional peaks and smart reframes key subjects.", p)
    elif p < 0.75:
        draw_subtitles_card(draw, "Burns animated word-by-word kinetic subtitles.", "Zero editing skills required. Ready for Instagram & YouTube.", p)
    else:
        draw_subtitles_card(draw, "Export ready-to-post reels every day with Sahkarmi!", "Supercharge your brand content pipeline effortlessly.", p)
        
    draw_cta_footer(draw)
    return img


# ==============================================================================
# SCENE 5: BUYER MARKET INTELLIGENCE
# ==============================================================================
def render_frame_market(t, total_t):
    img = Image.new("RGB", (WIDTH, HEIGHT), (11, 15, 25))
    draw = ImageDraw.Draw(img)
    p = t / total_t
    
    draw_header_banner(draw, "⚡ USE CASE 05 / 07", "BUYER MARKET INTELLIGENCE", "Competitor Pricing Tracker, Sentiment Scrapes & Instant Buyer Alerts")
    
    wx, wy, ww, wh = 50, 220, 980, 1320
    draw_window_chrome(draw, wx, wy, ww, wh, "Sahkarmi Radar — Autonomous Market Intelligence", "RADAR ONLINE", (16, 185, 129))
    
    # Top KPI Strip
    kpis = [
        ("Competitors Tracked", "14 Active"),
        ("Price Changes Detected", "3 Today"),
        ("Buyer Pain Points", "28 Unmet"),
        ("Market Lead Advantage", "+18%")
    ]
    for i, (klabel, kval) in enumerate(kpis):
        kx = wx + 20 + i * 235
        draw.rounded_rectangle([kx, wy + 70, kx + 225, wy + 145], radius=10, fill=(30, 41, 59), outline=(51, 65, 85), width=1)
        draw.text((kx + 15, wy + 82), klabel, fill=(148, 163, 184), font=font_ui_xs)
        draw.text((kx + 15, wy + 105), kval, fill=(249, 115, 22) if i == 1 else (255, 255, 255), font=font_ui_bold)
        
    # Competitor Pricing Table
    tbl_y = wy + 165
    draw.rounded_rectangle([wx + 20, tbl_y, wx + ww - 20, tbl_y + 420], radius=12, fill=(15, 23, 42), outline=(51, 65, 85), width=2)
    draw.rectangle([wx + 20, tbl_y, wx + ww - 20, tbl_y + 50], fill=(30, 41, 59))
    
    draw.text((wx + 40, tbl_y + 15), "Product / Service", fill=(203, 213, 225), font=font_ui_sm)
    draw.text((wx + 340, tbl_y + 15), "Competitor Price", fill=(203, 213, 225), font=font_ui_sm)
    draw.text((wx + 560, tbl_y + 15), "Sahkarmi Price", fill=(203, 213, 225), font=font_ui_sm)
    draw.text((wx + 780, tbl_y + 15), "Status / Alert", fill=(203, 213, 225), font=font_ui_sm)
    
    rows = [
        ("WhatsApp Automation Suite", "₹2,499 / mo", "₹1,499 / mo", "🚨 Competitor Hiked +20%"),
        ("Accounting OCR Engine", "₹1,899 / mo", "₹999 / mo", "🟢 40% Cheaper"),
        ("Social Scheduler Bot", "₹1,200 / mo", "Included Free", "🔥 Unfair Advantage"),
        ("Multi-Agent Dev Team", "Not Offered", "Included Local", "💎 100% Unique Offering")
    ]
    for idx, (prod, cprice, sprice, stat) in enumerate(rows):
        ry = tbl_y + 60 + idx * 85
        draw.line([wx + 20, ry, wx + ww - 20, ry], fill=(30, 41, 59), width=1)
        draw.text((wx + 40, ry + 25), prod, fill=(241, 245, 249), font=font_ui_sm)
        draw.text((wx + 340, ry + 25), cprice, fill=(239, 68, 68), font=font_ui_bold)
        draw.text((wx + 560, ry + 25), sprice, fill=(34, 197, 94), font=font_ui_bold)
        draw.text((wx + 780, ry + 25), stat, fill=(250, 204, 21), font=font_ui_xs)
        
    # Live Opportunity Alert Card (Sliding in)
    alert_y = wy + 610
    draw.rounded_rectangle([wx + 20, alert_y, wx + ww - 20, alert_y + 360], radius=14, fill=(24, 24, 27), outline=(249, 115, 22), width=2)
    draw.rectangle([wx + 20, alert_y, wx + ww - 20, alert_y + 55], fill=(39, 39, 42))
    draw.text((wx + 40, alert_y + 16), "🚨 LIVE BUYER PAIN POINT DETECTED (SOCIAL RADAR)", fill=(249, 115, 22), font=font_ui_bold)
    
    draw.text((wx + 40, alert_y + 80), "Source: Twitter / LinkedIn India", fill=(148, 163, 184), font=font_ui_xs)
    draw.text((wx + 40, alert_y + 110), "\"Competitor X support is totally unresponsive & doubled prices today. Any good Indian alternatives?\"", fill=(241, 245, 249), font=font_ui_sm)
    
    # Auto-Generated Battlecard Box
    draw.rounded_rectangle([wx + 40, alert_y + 165, wx + ww - 40, alert_y + 275], radius=10, fill=(30, 41, 59), outline=(52, 211, 153), width=1)
    draw.text((wx + 60, alert_y + 180), "🤖 Sahkarmi Auto-Drafted Counter-Pitch:", fill=(52, 211, 153), font=font_ui_bold)
    draw.text((wx + 60, alert_y + 215), "\"Hi! Sahkarmi runs 100% on your PC with zero API fees and 24/7 instant WhatsApp support. Try here:\"", fill=(226, 232, 240), font=font_ui_sm)
    
    # Action button
    draw.rounded_rectangle([wx + 40, alert_y + 295, wx + 480, alert_y + 345], radius=10, fill=(234, 88, 12))
    draw.text((wx + 75, alert_y + 310), "⚡ Send Pitch to 14 Prospective Leads", fill=(255, 255, 255), font=font_ui_bold)

    # Mascot avatar badge
    if mascot_thumb:
        img.paste(mascot_thumb, (wx + ww - 140, wy + wh - 200), mascot_thumb)

    # Animated Cursor
    click_pulse = 0.0
    if p < 0.40:
        cx_cur = wx + 380 + int(p * 200)
        cy_cur = tbl_y + 150
    elif p < 0.70:
        cx_cur = wx + 260
        cy_cur = alert_y + 320
        click_pulse = (p - 0.60) / 0.10 if p >= 0.60 else 0.0
    else:
        cx_cur = wx + 600
        cy_cur = alert_y + 200
        
    draw_cursor(draw, cx_cur, cy_cur, click_pulse)
    
    # Subtitles
    if p < 0.22:
        draw_subtitles_card(draw, "Stop losing deals to competitors.", "Sahkarmi tracks competitor pricing & product updates daily.", p)
    elif p < 0.50:
        draw_subtitles_card(draw, "Alerts your sales team when buyers express pain points.", "Monitors social media complaints and price hikes in real-time.", p)
    elif p < 0.75:
        draw_subtitles_card(draw, "Auto-generates battlecards & high converting pitches.", "Equips your team with instant rebuttals and counter-offers.", p)
    else:
        draw_subtitles_card(draw, "Get an unfair market advantage with Sahkarmi!", "Dominate your niche with automated competitive intelligence.", p)
        
    draw_cta_footer(draw)
    return img


# ==============================================================================
# SCENE 6: GST INVOICE ACCOUNTING ASSISTANT
# ==============================================================================
def render_frame_gst(t, total_t):
    img = Image.new("RGB", (WIDTH, HEIGHT), (11, 15, 25))
    draw = ImageDraw.Draw(img)
    p = t / total_t
    
    draw_header_banner(draw, "⚡ USE CASE 06 / 07", "GST INVOICE ASSISTANT", "Automated OCR Extraction, GSTR-2B ITC Matching & Direct Tally Sync")
    
    wx, wy, ww, wh = 50, 220, 980, 1320
    draw_window_chrome(draw, wx, wy, ww, wh, "Sahkarmi Tax Engine — Invoice Extractor & Reconciliation", "GSTR-2B MATCHED", (34, 197, 94))
    
    # Split Screen: Left PDF Invoice (width 460) | Right AI Data Panel (width 480)
    split_w = 460
    
    # Left PDF Viewer
    draw.rectangle([wx + 2, wy + 56, wx + split_w, wy + wh - 2], fill=(245, 245, 247))
    draw.line([wx + split_w, wy + 56, wx + split_w, wy + wh - 2], fill=(209, 213, 219), width=2)
    
    # Simulated Tax Invoice Document
    draw.text((wx + 30, wy + 80), "TAX INVOICE", fill=(17, 24, 39), font=font_ui_bold)
    draw.text((wx + 30, wy + 115), "Vendor: Shree Ganesh Enterprises", fill=(31, 41, 55), font=font_ui_bold)
    draw.text((wx + 30, wy + 145), "GSTIN: 27AABCS1429B1Z2", fill=(31, 41, 55), font=font_ui_reg)
    draw.text((wx + 30, wy + 175), "Invoice No: SGE/2026/0892", fill=(75, 85, 99), font=font_ui_sm)
    draw.text((wx + 30, wy + 205), "Date: 22-Oct-2026", fill=(75, 85, 99), font=font_ui_sm)
    
    # Animated Scanning Bounding Box (Cyan/Green) over GSTIN
    draw.rounded_rectangle([wx + 25, wy + 140, wx + 380, wy + 170], radius=4, outline=(14, 165, 233), width=2)
    draw.text((wx + 390, wy + 145), "✓ OCR", fill=(14, 165, 233), font=font_ui_xs)
    
    # Invoice Line Items Table
    draw.line([wx + 25, wy + 245, wx + split_w - 25, wy + 245], fill=(209, 213, 219), width=2)
    draw.text((wx + 30, wy + 255), "Item Description", fill=(55, 65, 81), font=font_ui_xs)
    draw.text((wx + 240, wy + 255), "HSN", fill=(55, 65, 81), font=font_ui_xs)
    draw.text((wx + 350, wy + 255), "Total", fill=(55, 65, 81), font=font_ui_xs)
    draw.line([wx + 25, wy + 280, wx + split_w - 25, wy + 280], fill=(209, 213, 219), width=1)
    
    items = [
        ("Cloud Server Hosting", "8471", "₹38,372.88"),
        ("Technical Support Fee", "9983", "₹5,000.00")
    ]
    for idx, (desc, hsn, tot) in enumerate(items):
        iy = wy + 295 + idx * 45
        draw.text((wx + 30, iy), desc, fill=(17, 24, 39), font=font_ui_sm)
        draw.text((wx + 240, iy), hsn, fill=(75, 85, 99), font=font_ui_sm)
        draw.text((wx + 350, iy), tot, fill=(17, 24, 39), font=font_ui_bold)
        
    # Tax Breakdown Box
    draw.rounded_rectangle([wx + 25, wy + 400, wx + split_w - 25, wy + 550], radius=8, fill=(255, 255, 255), outline=(16, 185, 129), width=2)
    draw.text((wx + 40, wy + 415), "Taxable Subtotal: ₹38,372.88", fill=(55, 65, 81), font=font_ui_sm)
    draw.text((wx + 40, wy + 445), "CGST (9.0%): ₹3,453.56", fill=(55, 65, 81), font=font_ui_sm)
    draw.text((wx + 40, wy + 475), "SGST (9.0%): ₹3,453.56", fill=(55, 65, 81), font=font_ui_sm)
    draw.text((wx + 40, wy + 510), "Grand Total: ₹45,280.00", fill=(17, 24, 39), font=font_ui_bold)
    
    # Right Side: Sahkarmi AI Accounting Dashboard
    rx = wx + split_w + 20
    rw = ww - split_w - 40
    
    draw.text((rx, wy + 80), "Sahkarmi Accounting Coworker 'Asha'", fill=(249, 115, 22), font=font_ui_bold)
    draw.text((rx, wy + 115), "Automated Extraction & Tax Audit", fill=(148, 163, 184), font=font_ui_sm)
    
    # Verification Checklist
    checks = [
        ("Vendor Identity Verified", "Active on GSTN Portal", (34, 197, 94)),
        ("GSTIN Match", "27AABCS1429B1Z2 (Valid)", (34, 197, 94)),
        ("Mathematical Audit", "₹45,280.00 matches items", (34, 197, 94)),
        ("GSTR-2B ITC Eligibility", "100% Tax Credit Available", (34, 197, 94)),
        ("Duplicate Check", "No prior record found", (34, 197, 94))
    ]
    
    max_chk = int(len(checks) * min(1.0, (p / 0.50))) if p > 0.15 else 1
    for idx, (title_chk, sub_chk, col_chk) in enumerate(checks[:max_chk]):
        cy = wy + 160 + idx * 80
        draw.rounded_rectangle([rx, cy, rx + rw, cy + 68], radius=10, fill=(30, 41, 59), outline=col_chk, width=1)
        draw.ellipse([rx + 15, cy + 24, rx + 35, cy + 44], fill=col_chk)
        draw.text((rx + 20, cy + 26), "✓", fill=(255, 255, 255), font=font_ui_xs)
        draw.text((rx + 50, cy + 12), title_chk, fill=(241, 245, 249), font=font_ui_bold)
        draw.text((rx + 50, cy + 38), sub_chk, fill=(148, 163, 184), font=font_ui_xs)
        
    # Export Actions
    act_y = wy + 600
    draw.text((rx, act_y), "Accounting Software Direct Sync:", fill=(203, 213, 225), font=font_ui_bold)
    
    btn_col = (34, 197, 94) if p > 0.65 else (234, 88, 12)
    btn_lbl = "✓ SYNCED TO TALLY PRIME & ZOHO BOOKS" if p > 0.65 else "⚡ EXPORT TO TALLY XML & ZOHO"
    draw.rounded_rectangle([rx, act_y + 40, rx + rw, act_y + 105], radius=12, fill=btn_col)
    draw.text((rx + 30, act_y + 58), btn_lbl, fill=(255, 255, 255), font=font_ui_bold)
    
    if p > 0.70:
        # Audit Confirmation Card
        draw.rounded_rectangle([rx, act_y + 125, rx + rw, act_y + 240], radius=12, fill=(15, 23, 42), outline=(34, 197, 94), width=2)
        draw.text((rx + 20, act_y + 145), "📊 RECONCILIATION SUMMARY:", fill=(34, 197, 94), font=font_ui_bold)
        draw.text((rx + 20, act_y + 175), "• CGST + SGST ITC Claimed: ₹6,907.12", fill=(241, 245, 249), font=font_ui_sm)
        draw.text((rx + 20, act_y + 205), "• GSTR-3B Tax Liability Reduced Automatically", fill=(249, 115, 22), font=font_ui_xs)

    # Mascot avatar badge
    if mascot_thumb:
        img.paste(mascot_thumb, (wx + ww - 140, wy + wh - 200), mascot_thumb)

    # Animated Cursor
    click_pulse = 0.0
    if p < 0.40:
        cx_cur = wx + 180 + int(p * 100)
        cy_cur = wy + 160
    elif p < 0.70:
        cx_cur = rx + rw // 2
        cy_cur = act_y + 70
        click_pulse = (p - 0.60) / 0.10 if p >= 0.60 else 0.0
    else:
        cx_cur = rx + rw // 2
        cy_cur = act_y + 180
        
    draw_cursor(draw, cx_cur, cy_cur, click_pulse)
    
    # Subtitles
    if p < 0.22:
        draw_subtitles_card(draw, "Tired of manual invoice entry and tax mismatches?", "Sahkarmi AI extracts vendor bills with 99% accuracy.", p)
    elif p < 0.50:
        draw_subtitles_card(draw, "Auto-reconciles GSTR-2B filings & checks GSTINs.", "Verifies tax math, detects duplicates and confirms credits.", p)
    elif p < 0.75:
        draw_subtitles_card(draw, "Exports directly to Tally Prime or Zoho Books.", "Zero data entry errors, clean books and stress-free audits.", p)
    else:
        draw_subtitles_card(draw, "Clean bookkeeping with Sahkarmi today!", "Automate your company's entire accounting workflow locally.", p)
        
    draw_cta_footer(draw)
    return img


# ==============================================================================
# SCENE 7: DAILY EXECUTIVE BRIEFING (MITRA)
# ==============================================================================
def render_frame_briefing(t, total_t):
    img = Image.new("RGB", (WIDTH, HEIGHT), (11, 15, 25))
    draw = ImageDraw.Draw(img)
    p = t / total_t
    
    draw_header_banner(draw, "⚡ USE CASE 07 / 07", "DAILY EXECUTIVE BRIEFING", "Morning WhatsApp Audio Note & Real-Time Business Cockpit by Mitra")
    
    wx, wy, ww, wh = 50, 220, 980, 1320
    draw_window_chrome(draw, wx, wy, ww, wh, "Mitra Executive Cockpit — 8:00 AM Morning Briefing", "BRIEFING READY", (249, 115, 22))
    
    # Top CEO Greeting
    draw.text((wx + 30, wy + 80), "Good Morning Dhrubo! 🌅", fill=(255, 255, 255), font=font_ui_bold)
    draw.text((wx + 30, wy + 115), "Here is your 3-minute executive briefing prepared overnight by Mitra:", fill=(148, 163, 184), font=font_ui_sm)
    
    # 3 Real-time Metric Cards
    metrics = [
        ("Today's Revenue", "₹4,82,500", "+24.8% vs last week", (34, 197, 94)),
        ("Active Leads / Users", "12,450", "38 new deals closed", (59, 130, 246)),
        ("Cash Flow & Runway", "₹38.2 Lakhs", "18 months safe runway", (249, 115, 22))
    ]
    for i, (mlbl, mval, msub, mcol) in enumerate(metrics):
        mx = wx + 25 + i * 315
        draw.rounded_rectangle([mx, wy + 160, mx + 305, wy + 265], radius=12, fill=(30, 41, 59), outline=mcol, width=2)
        draw.text((mx + 15, wy + 175), mlbl, fill=(148, 163, 184), font=font_ui_xs)
        draw.text((mx + 15, wy + 200), mval, fill=(255, 255, 255), font=font_ui_bold)
        draw.text((mx + 15, wy + 235), msub, fill=mcol, font=font_ui_xs)
        
    # Simulated WhatsApp Morning Voice Note & Summary Card
    card_y = wy + 295
    draw.rounded_rectangle([wx + 25, card_y, wx + ww - 25, card_y + 490], radius=16, fill=(15, 23, 42), outline=(0, 168, 132), width=2)
    draw.rectangle([wx + 25, card_y, wx + ww - 25, card_y + 60], fill=(32, 44, 51))
    
    # WhatsApp Header
    draw.ellipse([wx + 45, card_y + 12, wx + 85, card_y + 52], fill=(234, 88, 12))
    draw.text((wx + 56, card_y + 20), "M", fill=(255, 255, 255), font=font_ui_bold)
    draw.text((wx + 100, card_y + 15), "Mitra (AI Chief of Staff)", fill=(233, 237, 239), font=font_ui_bold)
    draw.text((wx + 100, card_y + 38), "WhatsApp Voice Note • Delivered 08:00 AM IST", fill=(0, 168, 132), font=font_ui_xs)
    
    # Voice Note Player Bar
    vn_y = card_y + 80
    draw.rounded_rectangle([wx + 50, vn_y, wx + ww - 50, vn_y + 70], radius=12, fill=(32, 44, 51))
    draw.ellipse([wx + 70, vn_y + 15, wx + 110, vn_y + 55], fill=(0, 168, 132))
    # Play icon
    draw.polygon([(wx + 85, vn_y + 25), (wx + 100, vn_y + 35), (wx + 85, vn_y + 45)], fill=(255, 255, 255))
    
    # Audio Waveform bars playing
    for b in range(36):
        bx = wx + 130 + b * 19
        bh = int(10 + 20 * math.sin(t * 10 + b * 0.4) ** 2)
        draw.line([bx, vn_y + 35 - bh, bx, vn_y + 35 + bh], fill=(0, 168, 132) if bx < wx + 130 + int(p * 680) else (100, 116, 139), width=3)
        
    draw.text((wx + ww - 130, vn_y + 26), "02:45", fill=(148, 163, 184), font=font_ui_xs)
    
    # 3 Crisp Action Points
    bullets = [
        ("1. Revenue Surge", "WhatsApp outreach closed ₹4.82 Lakhs with zero manual follow-ups."),
        ("2. Software Release", "Multi-Agent Dev Team merged release v0.5.5; all 68 tests green."),
        ("3. Tax & Bookkeeping", "GST coworker reconciled ₹6.9K ITC credit ready for GSTR-3B.")
    ]
    for idx, (btitle, bdesc) in enumerate(bullets):
        by = card_y + 175 + idx * 80
        draw.text((wx + 50, by), btitle, fill=(249, 115, 22), font=font_ui_bold)
        draw.text((wx + 50, by + 28), bdesc, fill=(226, 232, 240), font=font_ui_sm)
        
    # Quick Approval Button
    app_y = card_y + 415
    draw.rounded_rectangle([wx + 50, app_y, wx + 540, app_y + 55], radius=10, fill=(16, 185, 129))
    draw.text((wx + 80, app_y + 15), "✓ Approve Today's Sprint & Outreach", fill=(255, 255, 255), font=font_ui_bold)
    
    # Bottom Milestone Banner
    ms_y = wy + 810
    draw.rounded_rectangle([wx + 25, ms_y, wx + ww - 25, ms_y + 180], radius=14, fill=(30, 41, 59), outline=(99, 102, 241), width=1)
    draw.text((wx + 50, ms_y + 20), "🚀 ALL 7 SAHKARMI COWORKERS CONNECTED & SYNCHRONIZED", fill=(165, 180, 252), font=font_ui_bold)
    draw.text((wx + 50, ms_y + 60), "• Local on your PC • Zero API monthly fees • Complete Data Privacy", fill=(226, 232, 240), font=font_ui_sm)
    draw.text((wx + 50, ms_y + 100), "• WhatsApp + Social + Code + Video + Tax + Market Intelligence", fill=(52, 211, 153), font=font_ui_sm)

    # Mascot avatar badge
    if mascot_thumb:
        img.paste(mascot_thumb, (wx + ww - 140, wy + wh - 200), mascot_thumb)

    # Animated Cursor
    click_pulse = 0.0
    if p < 0.40:
        cx_cur = wx + 180 + int(p * 150)
        cy_cur = vn_y + 35
    elif p < 0.75:
        cx_cur = wx + 300
        cy_cur = app_y + 25
        click_pulse = (p - 0.65) / 0.10 if p >= 0.65 else 0.0
    else:
        cx_cur = wx + 500
        cy_cur = ms_y + 60
        
    draw_cursor(draw, cx_cur, cy_cur, click_pulse)
    
    # Subtitles
    if p < 0.22:
        draw_subtitles_card(draw, "Start every morning with complete business clarity.", "Mitra connects revenue, traffic, and team milestones overnight.", p)
    elif p < 0.50:
        draw_subtitles_card(draw, "A 3-minute WhatsApp briefing straight to your phone.", "Delivered before your morning chai at 8:00 AM every day.", p)
    elif p < 0.75:
        draw_subtitles_card(draw, "Instant approvals, live KPIs and zero surprises.", "Coordinate your entire company operations in minutes.", p)
    else:
        draw_subtitles_card(draw, "Run your business smarter with Sahkarmi today!", "Download free for Windows and Mac at sahkarmi.ai", p)
        
    draw_cta_footer(draw)
    return img


# ==============================================================================
# PIPELINE RUNNER
# ==============================================================================
SCENES = [
    {
        "id": "01_WhatsApp_Web_Outreach",
        "audio": os.path.join(AUDIO_DIR, "01_WhatsApp_Web_Outreach.mp3"),
        "render_func": render_frame_whatsapp,
        "output": os.path.join(OUTPUT_DIR, "01_WhatsApp_Web_Outreach.mp4")
    },
    {
        "id": "02_Social_Media_Platform_Manager",
        "audio": os.path.join(AUDIO_DIR, "02_Social_Media_Platform_Manager.mp3"),
        "render_func": render_frame_social,
        "output": os.path.join(OUTPUT_DIR, "02_Social_Media_Platform_Manager.mp4")
    },
    {
        "id": "03_Full_Software_Dev_Team",
        "audio": os.path.join(AUDIO_DIR, "03_Full_Software_Dev_Team.mp3"),
        "render_func": render_frame_software,
        "output": os.path.join(OUTPUT_DIR, "03_Full_Software_Dev_Team.mp4")
    },
    {
        "id": "04_Autonomous_Video_Producer",
        "audio": os.path.join(AUDIO_DIR, "04_Autonomous_Video_Producer.mp3"),
        "render_func": render_frame_video,
        "output": os.path.join(OUTPUT_DIR, "04_Autonomous_Video_Producer.mp4")
    },
    {
        "id": "05_Buyer_Market_Intelligence",
        "audio": os.path.join(AUDIO_DIR, "05_Buyer_Market_Intelligence.mp3"),
        "render_func": render_frame_market,
        "output": os.path.join(OUTPUT_DIR, "05_Buyer_Market_Intelligence.mp4")
    },
    {
        "id": "06_GST_Invoice_Accounting_Assistant",
        "audio": os.path.join(AUDIO_DIR, "06_GST_Invoice_Accounting_Assistant.mp3"),
        "render_func": render_frame_gst,
        "output": os.path.join(OUTPUT_DIR, "06_GST_Invoice_Accounting_Assistant.mp4")
    },
    {
        "id": "07_Daily_Executive_Briefing_Mitra",
        "audio": os.path.join(AUDIO_DIR, "07_Daily_Executive_Briefing_Mitra.mp3"),
        "render_func": render_frame_briefing,
        "output": os.path.join(OUTPUT_DIR, "07_Daily_Executive_Briefing_Mitra.mp4")
    }
]

def get_audio_duration(path):
    res = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", path
    ], capture_output=True, text=True)
    return float(res.stdout.strip())

def main():
    print(f"==================================================")
    print(f"🎬 RENDERING 7 SCREEN RECORDING EXPLAINER REELS")
    print(f"Format: 1080x1920 (9:16 Vertical Mobile), 30 FPS")
    print(f"Audio: Indian Female (en-IN-NeerjaNeural)")
    print(f"Destination: {OUTPUT_DIR}")
    print(f"==================================================")
    
    for idx, sc in enumerate(SCENES):
        scene_id = sc["id"]
        audio_file = sc["audio"]
        out_file = sc["output"]
        render_fn = sc["render_func"]
        
        dur = get_audio_duration(audio_file)
        # Pad by 0.5s for clean audio decay
        total_dur = dur + 0.5
        total_frames = int(total_dur * FPS)
        
        print(f"\n[{idx+1}/7] Processing {scene_id}...")
        print(f"  Duration: {total_dur:.2f}s ({total_frames} frames)")
        
        cmd = [
            "ffmpeg", "-y",
            "-f", "rawvideo",
            "-vcodec", "rawvideo",
            "-s", f"{WIDTH}x{HEIGHT}",
            "-pix_fmt", "rgb24",
            "-r", str(FPS),
            "-i", "-",
            "-i", audio_file,
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            out_file
        ]
        
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
        
        for frame_idx in range(total_frames):
            t = frame_idx / float(FPS)
            frame_img = render_fn(t, total_dur)
            proc.stdin.write(frame_img.tobytes())
            
            if frame_idx % 90 == 0 or frame_idx == total_frames - 1:
                sys.stdout.write(f"\r  Rendering: {frame_idx+1}/{total_frames} frames ({(frame_idx+1)/total_frames*100:.1f}%)")
                sys.stdout.flush()
                
        proc.stdin.close()
        proc.wait()
        
        size_mb = os.path.getsize(out_file) / (1024 * 1024)
        print(f"\n  [SUCCESS] Generated: {out_file} ({size_mb:.2f} MB)")
        
    print("\n🎉 ALL 7 SCREEN RECORDING EXPLAINER VIDEOS COMPLETED!")

if __name__ == "__main__":
    main()
