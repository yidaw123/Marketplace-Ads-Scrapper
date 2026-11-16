"""
Regression tests for the rule-based classifier, built from real misclassifications
found when auditing scraped data. Run with:  python -m unittest test_classifier.py
"""
import unittest

from classifier import classify_post_rules, extract_contact_info


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
