import os
import sys
import math
import subprocess
from PIL import Image, ImageDraw, ImageFont

OUTPUT_DIR = r"C:\Users\Dhrubo\Desktop\ex video"
os.makedirs(OUTPUT_DIR, exist_ok=True)

WIDTH = 1080
HEIGHT = 1920
FPS = 24
DURATION_SEC = 5
TOTAL_FRAMES = FPS * DURATION_SEC

# Use standard Windows fonts
def get_font(size, bold=False):
    try:
        font_path = "C:/Windows/Fonts/segoeuib.ttf" if bold else "C:/Windows/Fonts/segoeui.ttf"
        return ImageFont.truetype(font_path, size)
    except Exception:
        return ImageFont.load_default()

font_brand = get_font(28, bold=True)
font_hero = get_font(60, bold=True)
font_subhero = get_font(30, bold=False)
font_step_title = get_font(34, bold=True)
font_step_desc = get_font(26, bold=False)
font_badge = get_font(24, bold=True)
font_metric_val = get_font(42, bold=True)
font_metric_lbl = get_font(20, bold=False)
font_cta = get_font(32, bold=True)

USE_CASES = [
    {
        "filename": "01_WhatsApp_Web_Outreach.mp4",
        "tag": "OUTREACH & CRM",
        "tag_color": (34, 197, 94), # green
        "title": "WHATSAPP WEB\nAI OUTREACH",
        "subtitle": "Autonomous Lead Ingestion & 24/7 Follow-Up",
        "steps": [
            ("1. Open WhatsApp Web", "Launches embedded private browser without APIs"),
            ("2. Scan & Match Leads", "Reads CRM contacts & detects purchase intent"),
            ("3. Contextual Personalization", "Drafts natural Hindi/Bengali/English replies"),
            ("4. Instant Order Closing", "Shares catalog, confirms address & invoices")
        ],
        "metrics": [
            ("+380%", "Reply Rate"),
            ("< 5 sec", "Response Time"),
            ("100%", "Private & Local")
        ],
        "sim_action": "💬 Sent: 'Namaste Rahul ji! Your order #5821 is dispatched...'"
    },
    {
        "filename": "02_Social_Media_Platform_Manager.mp4",
        "tag": "GROWTH ENGINE",
        "tag_color": (234, 88, 12), # saffron
        "title": "SOCIAL MEDIA\nPLATFORM MANAGER",
        "subtitle": "One Agent. 4 Networks. 100% Hands-Free.",
        "steps": [
            ("1. Trend Radar Scan", "Monitors trending viral hooks on X, IG & LinkedIn"),
            ("2. High-Converting Content", "Auto-writes carousel scripts & hook lines"),
            ("3. Scheduled Omnichannel Post", "Publishes at peak engagement hours automatically"),
            ("4. Inbound DM Lead Qualifying", "Replies to comments & sends booking links in DMs")
        ],
        "metrics": [
            ("4 Channels", "Simultaneous"),
            ("10x Output", "Weekly Growth"),
            ("24/7", "Active Engagement")
        ],
        "sim_action": "📱 Live: Post scheduled across LinkedIn, X & Instagram"
    },
    {
        "filename": "03_Full_Software_Dev_Team.mp4",
        "tag": "AUTONOMOUS DAG",
        "tag_color": (99, 102, 241), # indigo
        "title": "FULL SOFTWARE\nDEV TEAM (8 AGENTS)",
        "subtitle": "From Spec to Production Code in 1 Click",
        "steps": [
            ("1. Architecture Breakdown", "Mitra decomposes PRD into specialist tasks"),
            ("2. Full-Stack Coding", "Dev & Sneha write frontend & API endpoints"),
            ("3. Automated QA & Edge-Cases", "Kabir executes tests & verifies safety bounds"),
            ("4. CI/CD & Production Deploy", "Commits to Git, builds binaries & publishes")
        ],
        "metrics": [
            ("8 Specialists", "Collaborating"),
            ("Zero Loops", "Handoff Safety"),
            ("100%", "Native TS/Rust")
        ],
        "sim_action": "⚡ DAG: 8 agents active • All 68 tests passed green"
    },
    {
        "filename": "04_Autonomous_Video_Producer.mp4",
        "tag": "CONTENT PRODUCTION",
        "tag_color": (236, 72, 153), # pink
        "title": "AUTONOMOUS VIDEO\nEDITOR & REPURPOSER",
        "subtitle": "Raw Footage to Viral 9:16 Reels in Seconds",
        "steps": [
            ("1. Long-Form Video Ingest", "Pulls raw podcasts, webinars & demos"),
            ("2. Viral Moment Detection", "Finds highest retention hooks & emotional peaks"),
            ("3. 9:16 Framing & Auto-Crop", "Centers speaker with animated word captions"),
            ("4. Ready-To-Post Export", "Renders 60fps MP4 with SEO hashtags")
        ],
        "metrics": [
            ("50+ Reels/Day", "Batch Pipeline"),
            ("9:16 Portrait", "Shorts & Reels"),
            ("Auto-Subtitles", "Kinetic Typography")
        ],
        "sim_action": "🎬 Exported: 'How AI changes Indian startups.mp4' (1080x1920)"
    },
    {
        "filename": "05_Buyer_Market_Intelligence.mp4",
        "tag": "MARKET INTEL",
        "tag_color": (6, 182, 212), # cyan
        "title": "BUYER & COMPETITOR\nINTELLIGENCE RADAR",
        "subtitle": "Daily Market Shifts & Competitor Price Watch",
        "steps": [
            ("1. Competitor Scraping", "Monitors competitor pricing, launches & ads"),
            ("2. Review Sentiment Analysis", "Extracts unhappy customers & missing features"),
            ("3. Daily Opportunity Digest", "Synthesizes market gaps into actionable deals"),
            ("4. High-Intent Sales Alerts", "Notifies sales team when prospects look for alternatives")
        ],
        "metrics": [
            ("Real-Time", "Market Radar"),
            ("Zero Blindspots", "Daily Digest"),
            ("Unfair Advantage", "B2B Insights")
        ],
        "sim_action": "📊 Alert: 3 competitors raised pricing • 14 switch leads found"
    },
    {
        "filename": "06_GST_Invoice_Accounting_Assistant.mp4",
        "tag": "FINANCE & COMPLIANCE",
        "tag_color": (245, 158, 11), # amber
        "title": "GST & INVOICE\nACCOUNTING ASSISTANT",
        "subtitle": "Effortless Bookkeeping for Indian MSMEs",
        "steps": [
            ("1. Invoice & Receipt Parsing", "Scans PDF bills, vendor receipts & bank statements"),
            ("2. GSTIN & HSN Extraction", "Validates tax rates, CGST/SGST & vendor status"),
            ("3. GSTR-2B Auto-Reconciliation", "Flags tax discrepancies before filing deadlines"),
            ("4. One-Click Tally Export", "Syncs directly with Tally, Zoho Books & Excel")
        ],
        "metrics": [
            ("99.9% Accuracy", "Tax Compliance"),
            ("100% Offline", "Data Privacy"),
            ("Tally & Zoho", "Native Export")
        ],
        "sim_action": "📑 Reconciled: 142 vendor invoices • 0 mismatch errors"
    },
    {
        "filename": "07_Daily_Executive_Briefing_Mitra.mp4",
        "tag": "CHIEF OF STAFF",
        "tag_color": (168, 85, 247), # purple
        "title": "DAILY EXECUTIVE\nBRIEFING ('MITRA')",
        "subtitle": "Your 8:00 AM CEO Pulse on WhatsApp",
        "steps": [
            ("1. Full Business Ingestion", "Connects Razorpay revenue, traffic & operations"),
            ("2. Anomaly & Risk Detection", "Flags pending invoices, churn spikes & SLA delays"),
            ("3. Executive Synthesis", "Summarizes yesterday's ROI in 3 bullet points"),
            ("4. WhatsApp Morning Briefing", "Delivers audio & text briefing before your morning chai")
        ],
        "metrics": [
            ("3 Min Read", "Daily Synthesis"),
            ("0 Dashboards", "Straight to Phone"),
            ("100% Clarity", "Actionable Next Steps")
        ],
        "sim_action": "☕ Briefing Delivered: ₹1,42,800 revenue • 98% team task completion"
    }
]

def render_frame(case, frame_idx):
    progress = frame_idx / float(TOTAL_FRAMES)
    
    # Base dark gradient image
    img = Image.new("RGB", (WIDTH, HEIGHT), (9, 13, 26))
    draw = ImageDraw.Draw(img)
    
    # Ambient glowing orbs
    orb_alpha = int(45 + 15 * math.sin(progress * math.pi * 2))
    # Top right orb
    for r in range(300, 50, -30):
        color = (case["tag_color"][0] // 5, case["tag_color"][1] // 5, case["tag_color"][2] // 5)
        draw.ellipse([800 - r, 200 - r, 800 + r, 200 + r], fill=color)
    # Bottom left orb
    for r in range(260, 40, -30):
        draw.ellipse([150 - r, 1600 - r, 150 + r, 1600 + r], fill=(15, 25, 45))
        
    # Card container bounds
    cx1, cy1, cx2, cy2 = 60, 60, 1020, 1860
    draw.rounded_rectangle([cx1, cy1, cx2, cy2], radius=40, outline=(38, 48, 75), width=2, fill=(13, 18, 34))
    
    # Top Branding Header
    draw.rounded_rectangle([100, 100, 480, 155], radius=28, fill=(24, 32, 56), outline=(48, 62, 98), width=1)
    draw.ellipse([120, 120, 136, 136], fill=(34, 197, 94)) # glowing status dot
    draw.text((150, 114), "सहकर्मी SAHKARMI AI", fill=(255, 255, 255), font=font_brand)
    
    # Category tag badge
    draw.rounded_rectangle([720, 100, 980, 155], radius=28, fill=(case["tag_color"][0] // 4, case["tag_color"][1] // 4, case["tag_color"][2] // 4), outline=case["tag_color"], width=1)
    draw.text((740, 115), case["tag"], fill=case["tag_color"], font=font_badge)
    
    # Hero Title
    y_title = 195
    lines = case["title"].split("\n")
    for line in lines:
        draw.text((100, y_title), line, fill=(255, 255, 255), font=font_hero)
        y_title += 70
        
    draw.text((100, y_title + 10), case["subtitle"], fill=(156, 163, 175), font=font_subhero)
    
    # Workflow Stage Mockup (Central glass card)
    my1 = y_title + 80
    my2 = my1 + 760
    draw.rounded_rectangle([90, my1, 990, my2], radius=32, fill=(18, 26, 48), outline=(50, 66, 104), width=2)
    
    # Window mockup header bar
    draw.rounded_rectangle([90, my1, 990, my1 + 65], radius=32, fill=(24, 34, 60))
    draw.rectangle([90, my1 + 35, 990, my1 + 65], fill=(24, 34, 60))
    draw.ellipse([120, my1 + 24, 136, my1 + 40], fill=(239, 68, 68)) # red
    draw.ellipse([148, my1 + 24, 164, my1 + 40], fill=(245, 158, 11)) # yellow
    draw.ellipse([176, my1 + 24, 192, my1 + 40], fill=(34, 197, 94)) # green
    draw.text((220, my1 + 18), "Autonomous Coworker Execution Engine", fill=(148, 163, 184), font=font_badge)
    
    # Step cards
    step_y = my1 + 85
    step_progress = progress * 4.0
    for i, (st, sd) in enumerate(case["steps"]):
        is_active = step_progress >= i
        card_bg = (28, 40, 72) if is_active else (20, 28, 50)
        border_col = case["tag_color"] if (is_active and step_progress < i + 1) else ((55, 75, 120) if is_active else (30, 42, 68))
        
        draw.rounded_rectangle([120, step_y, 960, step_y + 115], radius=20, fill=card_bg, outline=border_col, width=2 if is_active else 1)
        
        # Step number circle
        num_col = case["tag_color"] if is_active else (100, 116, 139)
        draw.ellipse([145, step_y + 25, 205, step_y + 85], fill=(15, 23, 42), outline=num_col, width=2)
        draw.text((165, step_y + 36), f"0{i+1}", fill=num_col, font=font_badge)
        
        # Text
        draw.text((225, step_y + 22), st, fill=(255, 255, 255) if is_active else (148, 163, 184), font=font_step_title)
        draw.text((225, step_y + 64), sd, fill=(203, 213, 225) if is_active else (100, 116, 139), font=font_step_desc)
        
        # Checkmark when completed
        if step_progress >= i + 1:
            draw.text((915, step_y + 36), "✓", fill=(34, 197, 94), font=font_step_title)
            
        step_y += 135
        
    # Live Simulated Action Pill inside mockup
    draw.rounded_rectangle([120, my2 - 130, 960, my2 - 30], radius=20, fill=(12, 17, 30), outline=(50, 70, 110), width=1)
    draw.text((140, my2 - 100), case["sim_action"][:68] + "…", fill=(250, 204, 21), font=font_step_desc)
    
    # Animated Progress Bar across bottom of mockup
    bar_width = int(870 * min(1.0, progress * 1.05))
    draw.rectangle([90, my2 - 8, 990, my2], fill=(30, 42, 68))
    draw.rectangle([90, my2 - 8, 90 + bar_width, my2], fill=case["tag_color"])
    
    # 3 Stat Metric Tiles
    stat_y = my2 + 40
    stat_w = 270
    for idx, (val, lbl) in enumerate(case["metrics"]):
        sx = 100 + idx * 300
        draw.rounded_rectangle([sx, stat_y, sx + stat_w, stat_y + 130], radius=24, fill=(20, 28, 52), outline=(45, 60, 95), width=1)
        draw.text((sx + 24, stat_y + 18), val, fill=(255, 255, 255), font=font_metric_val)
        draw.text((sx + 24, stat_y + 78), lbl, fill=(148, 163, 184), font=font_metric_lbl)
        
    # Bottom Call to Action
    cta_y = stat_y + 160
    cta_fill = (234, 88, 12) # brand orange
    draw.rounded_rectangle([100, cta_y, 980, cta_y + 100], radius=30, fill=cta_fill, outline=(251, 146, 60), width=2)
    draw.text((220, cta_y + 30), "🚀 Download Free App: sahkarmi.site", fill=(255, 255, 255), font=font_cta)
    
    return img

print("Rendering 7 Mobile Explainer Videos (1080x1920)...")
for idx, case in enumerate(USE_CASES):
    out_path = os.path.join(OUTPUT_DIR, case["filename"])
    print(f"[{idx+1}/7] Generating '{case['filename']}'...")
    
    cmd = [
        "ffmpeg", "-y",
        "-f", "image2pipe",
        "-vcodec", "png",
        "-r", str(FPS),
        "-i", "-",
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-preset", "veryfast",
        "-crf", "18",
        out_path
    ]
    
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    
    for f in range(TOTAL_FRAMES):
        frame_img = render_frame(case, f)
        frame_img.save(proc.stdin, "PNG")
        
    proc.stdin.close()
    proc.wait()
    print(f" -> Completed: {out_path} ({os.path.getsize(out_path)} bytes)")

print("\nALL 7 EXPLAINER VIDEOS COMPLETED SUCCESSFULLY IN:")
print(OUTPUT_DIR)
