"""
Regression tests for the rule-based classifier, built from real misclassifications
found when auditing scraped data. Run with:  python -m unittest test_classifier.py
"""
import unittest

from classifier import (
    classify_creator,
    classify_post_rules,
    compute_audience_tier,
    extract_contact_info,
    extract_creator_location,
)
from scrapers.creators_scraper import (
    _classify_creator_links,
    _decode_cfemail,
    _extract_clean_emails,
    _parse_html_page_signals,
)


def classify(title, body="", platform="reddit", source="r/bayarea"):
    return classify_post_rules(
        {"title": title, "body": body, "platform": platform, "source_detail": source}
    )


class IntentTests(unittest.TestCase):
    # ---- Real homeowner demand ----
    def test_reddit_handyman_request(self):
        r = classify("Looking for handyman around Oakland to retrofit dishwasher",
                     "Looking for a recommendation for a local handy man")
        self.assertEqual(r["intent_type"], "customer_hiring")

    def test_craigslist_homeowner_gig(self):
        r = classify("Handyman — run ethernet in open garage + mount doorbell (Mission)", "",
                     "craigslist", "sfbay/lbg (Labor Gigs)")
        self.assertEqual(r["intent_type"], "customer_hiring")

    def test_diy_question(self):
        r = classify("Is Screwing Off a Shower Head Supposed to Be This Difficult?",
                     "I am trying to replace the shower head and the pipe keeps turning", source="r/DIY")
        self.assertEqual(r["intent_type"], "diy_help_needed")
        self.assertEqual(r["primary_category"], "Plumbing & Drain")

    # ---- Employer recruiting must NOT count as homeowner demand ----
    def test_job_posting_hourly(self):
        r = classify("EXPERIENCED COMMERCIAL HANDYMEN & PLUMBERS — $30/HR STARTING", "",
                     "craigslist", "austin/lbg (Labor Gigs)")
        self.assertEqual(r["intent_type"], "job_posting")

    def test_job_posting_helpers(self):
        r = classify("Helpers Wanted, Cash Pay, Start Today up to $320-400 per Day", "",
                     "craigslist", "newyork/lbg (Labor Gigs)")
        self.assertEqual(r["intent_type"], "job_posting")

    def test_job_posting_gig_app(self):
        r = classify("Handypeople & Skilled Workers: Earn on Taskrabbit", "",
                     "craigslist", "austin/lbg (Labor Gigs)")
        self.assertEqual(r["intent_type"], "job_posting")

    def test_job_posting_hourly_helper(self):
        r = classify("$20/hour - EXPERIENCED LANDSCAPER/HANDYMAN HELPER",
                     "MUST HAVE EXPERIENCE WITH LANDSCAPING WORK", "craigslist", "sfbay/lbg (Labor Gigs)")
        self.assertEqual(r["intent_type"], "job_posting")

    def test_job_posting_tradesmen(self):
        r = classify("Maintenance personal and Skilled Tradesmen/Laborers needed",
                     "We are looking for independent Contractors, Tradesmen and Handymen",
                     "craigslist", "sfbay/lbg (Labor Gigs)")
        self.assertEqual(r["intent_type"], "job_posting")

    def test_homeowner_move_gig_still_demand(self):
        r = classify("Meticulous handyman needed for move-out/move-in",
                     "I'm moving between two apartments and need shelves and TV mounted",
                     "craigslist", "newyork/lbg (Labor Gigs)")
        self.assertEqual(r["intent_type"], "customer_hiring")

    def test_hss_disguised_ad(self):
        r = classify("LOOKING FOR GOOD HANDYMAN??..CALL ARMANDO ANYTIME", "",
                     "craigslist", "austin/hss (Household Services)")
        self.assertEqual(r["intent_type"], "service_provider_ad")

    # ---- Providers ----
    def test_provider_ad_hss(self):
        r = classify("HANDYMAN AND REPAIRS", "", "craigslist", "austin/hss (Household Services)")
        self.assertEqual(r["intent_type"], "service_provider_ad")

    def test_provider_ad_in_gigs_with_phone(self):
        r = classify("*** HANDYMAN - BATHROOM REMODEL - PLUMBING ***",
                     "Licensed and insured, free estimates. Call 415-555-1234", "craigslist", "sfbay/lbg (Labor Gigs)")
        self.assertEqual(r["intent_type"], "service_provider_ad")

    # ---- Noise that used to be counted as demand ----
    def test_scam_warning_irrelevant(self):
        r = classify("THIS HANDYMAN/CONTRACTOR IS A SCAMMER", "DO NOT EVER HIRE THIS INDIVIDUAL")
        self.assertEqual(r["intent_type"], "irrelevant")

    def test_pro_community_chatter_irrelevant(self):
        r = classify("Husband has nightmare clients, what advice can I give?",
                     "He did a tile job for them", source="r/handyman")
        self.assertEqual(r["intent_type"], "irrelevant")

    def test_off_topic_fixit_irrelevant(self):
        r = classify("My headphones broke. Does anyone know how to fix them?", "", source="r/fixit")
        self.assertEqual(r["intent_type"], "irrelevant")


class CategoryTests(unittest.TestCase):
    def test_whole_word_matching(self):
        # "Hollywood" must not trigger the carpentry keyword "wood"; "front" must not match "rot"
        r = classify("Need a plumber in Hollywood, front bathroom toilet leaking", source="r/LosAngeles")
        self.assertEqual(r["primary_category"], "Plumbing & Drain")

    def test_tv_mounting(self):
        r = classify("Need someone to mount TV and assemble IKEA dresser this weekend")
        self.assertEqual(r["primary_category"], "Mounting & Furniture Assembly")
        self.assertEqual(r["intent_type"], "customer_hiring")
        self.assertEqual(r["urgency"], "high")

    def test_specific_work_beats_generic_handyman(self):
        r = classify("Looking for handyman around Oakland to retrofit dishwasher",
                     "Looking for a recommendation for a local handy man")
        self.assertEqual(r["primary_category"], "Appliance & HVAC Repair")

        r2 = classify("Need a handyman for yardwork and weeding in backyard")
        self.assertEqual(r2["primary_category"], "Yardwork & Landscaping")

        r3 = classify("Handyman needed to replace light switch and ceiling fan")
        self.assertEqual(r3["primary_category"], "Electrical & Lighting")


class ContactInfoTests(unittest.TestCase):
    def test_extracts_full_provider_contact_info(self):
        r = classify(
            "Licensed Plumbing & Drain Service - Call Armando Anytime",
            "Ask for Armando or call 415-555-1234. Email: armando@bayplumbing.com Website: https://www.bayplumbing.com",
            platform="craigslist",
            source="sfbay/hss (Household Services)",
        )
        self.assertEqual(r["contact_name"], "Armando")
        self.assertEqual(r["phone"], "415-555-1234")
        self.assertEqual(r["email"], "armando@bayplumbing.com")
        self.assertEqual(r["website"], "https://www.bayplumbing.com")

    def test_leaves_missing_fields_blank_and_ignores_imgur_on_diy(self):
        r = classify(
            "How do I fix a leaky kitchen faucet?",
            "Here is a photo of my sink: https://imgur.com/a/abc123",
            platform="reddit",
            source="r/DIY",
        )
        self.assertEqual(r["contact_name"], "")
        self.assertEqual(r["phone"], "")
        self.assertEqual(r["email"], "")
        self.assertEqual(r["website"], "")

    def test_extracts_chinese_contact_name_and_bare_domain(self):
        c = extract_contact_info(
            {
                "title": "专业屋顶补漏",
                "body": "联 系 人： 高师傅 (英语/国语) 联系电话： 647-998-8758 网站供参考:www.365ds.ca",
            },
            intent_type="service_provider_ad",
        )
        self.assertEqual(c["contact_name"], "高师傅")
        self.assertEqual(c["phone"], "647-998-8758")
        self.assertEqual(c["email"], "")
        self.assertEqual(c["website"], "www.365ds.ca")

    def test_bark_provider_classified_with_contact_info(self):
        r = classify_post_rules(
            {
                "title": "Wilson Contracting Co. — Handyman (Toronto / GTA, ON)",
                "body": "Competitive pricing for door repairs, drywall patching, and electrical.",
                "platform": "bark",
                "source_detail": "bark.com (Handyman)",
                "contact_name": "Wilson Contracting Co.",
                "website": "https://www.wilsoncontracting.ca",
            }
        )
        self.assertEqual(r["intent_type"], "service_provider_ad")
        self.assertEqual(r["contact_name"], "Wilson Contracting Co.")
        self.assertEqual(r["website"], "https://www.wilsoncontracting.ca")


class CreatorClassificationTests(unittest.TestCase):
    def test_audience_tier_thresholds(self):
        self.assertEqual(compute_audience_tier(1500000), "mega")
        self.assertEqual(compute_audience_tier(750000), "macro")
        self.assertEqual(compute_audience_tier(150000), "mid")
        self.assertEqual(compute_audience_tier(25000), "micro")
        self.assertEqual(compute_audience_tier(3200), "nano")

    def test_creator_location_us_ca_only(self):
        self.assertEqual(
            extract_creator_location("TileCoach", "Flooring contractor in Sacramento, CA", "United States"),
            ("Sacramento", "California", "United States"),
        )
        self.assertEqual(
            extract_creator_location("Vancouver Carpenter", "Drywall tips and tricks", ""),
            ("Vancouver", "British Columbia", "Canada"),
        )
        self.assertEqual(
            extract_creator_location("UK Builder", "Remodeling projects near London and Sacramento, CA", "United Kingdom"),
            ("", "", "United Kingdom"),
        )
        self.assertEqual(
            extract_creator_location("Garage Builder", "Projects, IN my shop", ""),
            ("", "", ""),
        )
        self.assertEqual(
            extract_creator_location("BYOT", "Using Milwaukee tools and Portland cement", "United States"),
            ("", "", "United States"),
        )
        self.assertEqual(
            extract_creator_location("WINNI", "1209 Tatnall Building Wilmington, DE", "United States"),
            ("", "", "United States"),
        )
        self.assertEqual(
            extract_creator_location("Pro", "Based in Milwaukee, WI", "United States"),
            ("Milwaukee", "Wisconsin", "United States"),
        )
        self.assertEqual(
            extract_creator_location("Fix This House", "PO BOX 123 BREMERTON, WA 98310", "United States"),
            ("Bremerton", "Washington", "United States"),
        )

    def test_creator_classified_into_trade_and_task_buckets(self):
        c = classify_creator(
            {
                "creator_id": "yt_got2learn",
                "name": "Got2Learn",
                "bio": "Plumbing tutorials: soldering copper pipes, fixing leaky shower valves, and unclogging drains.",
                "audience_count": 638000,
                "seed_topic": "plumbing leak repair diy",
            }
        )
        self.assertEqual(c["primary_category"], "Plumbing & Drain")
        self.assertEqual(c["audience_tier"], "macro")
        self.assertTrue(bool(c["sub_service"]))

    def test_clean_email_rejects_retina_images_and_keeps_business_email(self):
        sample = "Logo Badge@2x.png support@linktr.ee noreply@site.com Collabs: hello@diycreator.com"
        self.assertEqual(_extract_clean_emails(sample), ["hello@diycreator.com"])

    def test_email_strict_accuracy_and_obfuscation(self):
        noisy = (
            "support@milwaukeetool.com help@squarespace.com privacy@example.com "
            "user@domain.com admin@wix.com a1b2c3d4e5f6071890ab@random.io "
            "Sponsors & business inquiries: matt@thefixerhomerepair.com "
            "Also reach alex [at] buildcraft [dot] ca"
        )
        emails = _extract_clean_emails(
            noisy,
            allowed_site_domain="thefixerhomerepair.com",
            require_context_for_third_party=True,
        )
        self.assertIn("matt@thefixerhomerepair.com", emails)
        self.assertIn("alex@buildcraft.ca", emails)
        self.assertNotIn("support@milwaukeetool.com", emails)
        self.assertNotIn("user@domain.com", emails)

        # Third-party domain without outreach context or near false context is rejected
        site_copy = "Theme designed by studio@themeagency.io. Music by artist@beatmaker.fm."
        self.assertEqual(
            _extract_clean_emails(site_copy, allowed_site_domain="myhandyman.com", require_context_for_third_party=True),
            [],
        )

        # Cloudflare data-cfemail decoding (e.g. hello@diy.ca -> key 0x2a)
        plain = "hello@diy.ca"
        key = 0x2A
        encoded = f"{key:02x}" + "".join(f"{ord(c) ^ key:02x}" for c in plain)
        self.assertEqual(_decode_cfemail(encoded), plain)
        html_snippet = f'<html><body><p>Contact us: <span data-cfemail="{encoded}">[email]</span></p></body></html>'
        found_emails, _, _, _ = _parse_html_page_signals(html_snippet, page_url="https://diy.ca/contact", allowed_site_domain="diy.ca")
        self.assertIn(plain, found_emails)

    def test_new_platform_links_extracted_accurately(self):
        links = _classify_creator_links(
            [
                "https://www.pinterest.com/pin/123456789/",
                "https://www.pinterest.com/modernbuilds/",
                "https://www.threads.net/@modernbuilds",
                "https://www.linkedin.com/in/michael-montgomery-diy/",
                "https://www.reddit.com/u/modernbuilds",
                "https://www.amazon.com/shop/modernbuilds",
                "https://modernbuilds.com",
            ]
        )
        self.assertEqual(links["pinterest_url"], "https://www.pinterest.com/modernbuilds")
        self.assertEqual(links["threads_url"], "https://www.threads.net/@modernbuilds")
        self.assertEqual(links["linkedin_url"], "https://www.linkedin.com/in/michael-montgomery-diy")
        self.assertEqual(links["reddit_url"], "https://www.reddit.com/u/modernbuilds")
        self.assertEqual(links["amazon_store_url"], "https://www.amazon.com/shop/modernbuilds")
        self.assertEqual(links["website"], "https://modernbuilds.com")
        self.assertEqual(_classify_creator_links(["https://gopjn.com/t/1234", "https://hvacdirect.com"])["website"], "")
        self.assertEqual(_extract_clean_emails("info@hvacdirect.com"), [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
