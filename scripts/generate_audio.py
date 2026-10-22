import asyncio
import os
import subprocess
import edge_tts

SCRIPTS = {
    "01_WhatsApp_Web_Outreach": "Want to automate your customer outreach on WhatsApp? Watch this. Sahkarmi AI opens WhatsApp Web on your computer, scans your unread leads, and instantly sends personalized messages in Hindi or English. It answers questions, shares your catalog, and closes orders twenty-four seven. Zero manual work. Download Sahkarmi for your business today!",
    "02_Social_Media_Platform_Manager": "Managing multiple social media accounts is exhausting. Let your Sahkarmi AI coworker handle it. It analyzes viral trends across LinkedIn, Instagram, and Twitter, auto-writes high-converting posts, schedules them at peak engagement hours, and replies to prospective leads in DMs. Deploy your social media agent today with Sahkarmi!",
    "03_Full_Software_Dev_Team": "Need an entire software development team on your desktop? Sahkarmi deploys eight specialist AI agents working together in an autonomous graph. From product architecture and backend APIs to automated QA testing and CI CD releases, your team writes clean, production-ready code in minutes. Build faster with Sahkarmi!",
    "04_Autonomous_Video_Producer": "Turn long-form videos into viral mobile reels effortlessly. Sahkarmi AI scans your webinars and podcasts, detects the most engaging moments, crops them into nine by sixteen portrait format, and burns animated word-by-word subtitles. Export ready-to-post reels every day with Sahkarmi!",
    "05_Buyer_Market_Intelligence": "Stop losing deals to competitors. Sahkarmi's market intelligence coworker tracks competitor pricing, customer reviews, and product launches every single morning. When prospective buyers express pain points online, it alerts your sales team immediately. Get an unfair market advantage with Sahkarmi!",
    "06_GST_Invoice_Accounting_Assistant": "Tired of manual invoice entry and tax mismatches? Sahkarmi's accounting coworker scans vendor bills, extracts GSTIN and tax numbers with ninety-nine percent accuracy, auto-reconciles GSTR two B filings, and exports directly to Tally or Zoho Books. Clean bookkeeping, zero stress. Try Sahkarmi today!",
    "07_Daily_Executive_Briefing_Mitra": "Start every morning with complete business clarity. Mitra, your AI Chief of Staff, connects your revenue, traffic, and team milestones overnight. Before your morning chai at eight AM, it sends a crisp three-minute WhatsApp briefing straight to your phone. Run your business smarter with Sahkarmi!"
}

TEMP_DIR = r"C:\Users\Dhrubo\Desktop\ex video\temp_audio"
os.makedirs(TEMP_DIR, exist_ok=True)

async def main():
    print("Generating Indian female voiceovers with edge-tts (en-IN-NeerjaNeural)...")
    for key, text in SCRIPTS.items():
        mp3_path = os.path.join(TEMP_DIR, f"{key}.mp3")
        comm = edge_tts.Communicate(text, "en-IN-NeerjaNeural", rate="+3%")
        await comm.save(mp3_path)
        
        # Get duration using ffprobe
        res = subprocess.run([
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", mp3_path
        ], capture_output=True, text=True)
        dur = float(res.stdout.strip())
        print(f"[OK] {key}: {dur:.2f}s ({mp3_path})")

asyncio.run(main())
