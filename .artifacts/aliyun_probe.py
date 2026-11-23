#!/usr/bin/env python3
"""Read-only probe of the Alibaba Cloud account behind AccessKey.csv.

Why: the user asked what is free forever for tukuk.org. Before answering from docs I want
the facts about THIS account — who the key is (root vs RAM user), whether the account is
already a billed pay-as-you-go one, and whether anything billable already exists in it.

Hard rules:
  * only Describe/List/Get/Query actions — nothing here creates, changes or deletes;
  * the AccessKey secret is read from the CSV and NEVER printed, logged, or put in argv;
  * every response is reduced to the few fields we need.
"""
import base64
import csv
import json
import os
import secrets
import time
import urllib.error
import urllib.parse
import urllib.request

CSV = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "AccessKey.csv")


def load_key(path):
    with open(path, newline="") as fh:
        rows = list(csv.reader(fh))
    if not rows or rows[0][0].lower().startswith("accesskey"):
        rows = rows[1:]
    return rows[0][0].strip(), rows[0][1].strip()


def pct(s):
    """RFC3986 percent-encoding, the way Aliyun RPC signing wants it."""
    return urllib.parse.quote(str(s), safe="~")


def call(endpoint, action, version, extra=None):
    ak, sk = load_key(CSV)
    p = {
        "Action": action,
        "Version": version,
        "Format": "JSON",
        "AccessKeyId": ak,
        "SignatureMethod": "HMAC-SHA1",
        "SignatureVersion": "1.0",
        "SignatureNonce": secrets.token_hex(16),
        "Timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    p.update(extra or {})
    q = "&".join("%s=%s" % (pct(k), pct(p[k])) for k in sorted(p))
    sts = "GET&%s&%s" % (pct("/"), pct(q))
    sig = base64.b64encode(
        __import__("hmac").new((sk + "&").encode(), sts.encode(), __import__("hashlib").sha1).digest()
    ).decode()
    url = "%s?%s&Signature=%s" % (endpoint, q, pct(sig))
    try:
        with urllib.request.urlopen(url, timeout=30) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode())
        except Exception:
            body = {"raw": "<non-json>"}
        return {"_http": e.code, **body}
    except Exception as e:
        return {"_error": "%s: %s" % (type(e).__name__, e)}


def show(title, res, pick):
    print("== %s" % title)
    if "_error" in res or "_http" in res:
        print("   FAILED %s" % (res.get("_error") or "HTTP %s" % res.get("_http")))
        for k in ("Code", "Message", "HostId"):
            if res.get(k):
                print("   %s: %s" % (k, res[k]))
        return
    print("   " + pick(res))


def oss_getservice():
    """OSS uses its own signing scheme (v1: Date header + HMAC-SHA1 of the canonical
    string), not the RPC signature. GET / on a regional endpoint lists every bucket in the
    account. Returns parsed XML as a list of (name, location)."""
    ak, sk = load_key(CSV)
    date = time.strftime("%a, %d %b %Y %H:%M:%S GMT", time.gmtime())
    sts = "GET\n\n\n%s\n/" % date
    sig = base64.b64encode(
        __import__("hmac").new(sk.encode(), sts.encode(), __import__("hashlib").sha1).digest()
    ).decode()
    req = urllib.request.Request(
        "https://oss-ap-southeast-1.aliyuncs.com/",
        headers={"Date": date,
                 "Authorization": "OSS %s:%s" % (ak, sig),
                 "Host": "oss-ap-southeast-1.aliyuncs.com"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            xml = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return {"_http": e.code, "Code": e.read().decode("utf-8", "replace")[:200]}
    except Exception as e:
        return {"_error": "%s: %s" % (type(e).__name__, e)}
    import re
    buckets = re.findall(r"<Name>([^<]+)</Name>.*?<Location>([^<]+)</Location>", xml, re.S)
    return {"buckets": [{"Name": n, "Location": loc} for n, loc in buckets]}


if __name__ == "__main__":
    print("AccessKey file: %s  mode=%s  size=%d (secret values are never printed)"
          % (CSV, oct(os.stat(CSV).st_mode & 0o777), os.path.getsize(CSV)))
    ak, sk = load_key(CSV)
    print("key lengths: id=%d secret=%d" % (len(ak), len(sk)))

    show("who is this identity (STS GetCallerIdentity)",
         call("https://sts.aliyuncs.com", "GetCallerIdentity", "2015-04-01"),
         lambda r: "type=%s account=%s identity=%s arn=%s"
                   % (r.get("Type"), r.get("AccountId"), r.get("IdentityType"), r.get("Arn")))

    show("is it a billed account, and does it hold credit (BSS QueryAccountBalance)"
         " — China-site endpoint",
         call("https://business.aliyuncs.com", "QueryAccountBalance", "2017-12-14"),
         lambda r: "success=%s code=%s balance=%s currency=%s unsettled=%s"
                   % (r.get("Success"), (r.get("Code")),
                      (r.get("Data") or {}).get("AvailableAmount"),
                      (r.get("Data") or {}).get("Currency"),
                      (r.get("Data") or {}).get("UnclearedAmount")))

    show("BSS on the international site (business.ap-southeast-1)",
         call("https://business.ap-southeast-1.aliyuncs.com", "QueryAccountBalance", "2017-12-14"),
         lambda r: "success=%s code=%s balance=%s currency=%s unsettled=%s"
                   % (r.get("Success"), (r.get("Code")),
                      (r.get("Data") or {}).get("AvailableAmount"),
                      (r.get("Data") or {}).get("Currency"),
                      (r.get("Data") or {}).get("UnclearedAmount")))

    show("OSS buckets in the account (ListBuckets / GetService)",
         oss_getservice(),
         lambda r: "count=%d %s" % (len(r.get("buckets") or []),
                                    [(b["Name"], b["Location"]) for b in (r.get("buckets") or [])][:8]))

    for region in ("ap-southeast-1", "ap-southeast-5", "ap-northeast-1", "us-west-1",
                   "us-east-1", "eu-central-1", "cn-hangzhou", "cn-shenzhen"):
        show("ECS instances in %s" % region,
             call("https://ecs.%s.aliyuncs.com" % region, "DescribeInstances", "2014-05-26",
                  {"RegionId": region}),
             lambda r: "total=%s ids=%s" % (
                 (r.get("TotalCount")),
                 [i.get("InstanceId") + ":" + i.get("Status")
                  for i in (r.get("Instances", {}).get("Instance") or [])][:6]))

    show("RDS databases (Singapore)",
         call("https://rds.ap-southeast-1.aliyuncs.com", "DescribeDBInstances", "2014-08-15",
              {"RegionId": "ap-southeast-1"}),
         lambda r: "total=%s" % r.get("TotalRecordCount"))

    show("Redis / KVStore (Singapore)",
         call("https://r-kvstore.ap-southeast-1.aliyuncs.com", "DescribeInstances", "2015-01-01",
              {"RegionId": "ap-southeast-1"}),
         lambda r: "total=%s" % (r.get("TotalCount")))

    show("Simple Application Server (Singapore)",
         call("https://swas.ap-southeast-1.aliyuncs.com", "ListServers", "2020-06-01",
              {"RegionId": "ap-southeast-1"}),
         lambda r: json.dumps(r)[:300])

    show("RAM users (should be empty for a root key account)",
         call("https://ram.aliyuncs.com", "ListUsers", "2015-05-01"),
         lambda r: "users=%s" % [u.get("UserName") for u in
                                 (r.get("Users", {}).get("User") or [])][:8])

    # How many credentials does the ROOT account itself carry? Relevant to the security
    # advice: root AccessKeys can never be scoped down, so fewer is better.
    show("RAM account summary (credential/policy totals)",
         call("https://ram.aliyuncs.com", "GetAccountSummary", "2015-05-01"),
         lambda r: json.dumps(r.get("SummaryMap") or {})[:400])

    # Any free credits/coupons sitting in the account? "Free" only matters if it is real.
    show("BSS cash coupons / credits (international site)",
         call("https://business.ap-southeast-1.aliyuncs.com", "QueryCashCoupons", "2017-12-14"),
         lambda r: json.dumps(r)[:400])

    # The decisive number: was anything actually billed this month?
    show("BSS bill for 2026-10 (international site)",
         call("https://business.ap-southeast-1.aliyuncs.com", "QueryBill", "2017-12-14",
              {"BillingCycle": "2026-10"}),
         lambda r: json.dumps(r)[:400])

    # OSS says UserDisable — is that just OSS, or the whole account not activated?
    show("BSS account balance detail again, with the China-site product code",
         call("https://business.ap-southeast-1.aliyuncs.com", "QueryAdvanceServices",
              "2017-12-14", {"ProductCodes.1": "oss"}),
         lambda r: json.dumps(r)[:300])

    # History, not just this month: has ANY month ever produced a bill line?
    for cyc in ("2025-11", "2026-05", "2026-08", "2026-09"):
        show("BSS bill for %s" % cyc,
             call("https://business.ap-southeast-1.aliyuncs.com", "QueryBill", "2017-12-14",
                  {"BillingCycle": cyc}),
             lambda r: "total=%s items=%s" % (
                 (r.get("Data") or {}).get("TotalCount"),
                 [(i.get("ProductName"), i.get("PretaxAmount"))
                  for i in ((r.get("Data") or {}).get("Items") or {}).get("Item", [])][:5]))

    # Any subscription/prepaid instance at all (incl. expired trials)?
    show("BSS available instances (any product)",
         call("https://business.ap-southeast-1.aliyuncs.com", "QueryAvailableInstances",
              "2017-12-14", {"PageSize": "50"}),
         lambda r: json.dumps(r)[:400])

    # Security: how many AccessKeys does the ROOT account hold? Rotating means adding one
    # and removing the other, so the count decides the procedure.
    show("RAM ListAccessKeys (root, no UserName)",
         call("https://ram.aliyuncs.com", "ListAccessKeys", "2015-05-01"),
         lambda r: "count=%s statuses=%s created=%s" % (
             len(r.get("AccessKeys", {}).get("AccessKey") or []),
             [k.get("Status") for k in (r.get("AccessKeys", {}).get("AccessKey") or [])],
             [k.get("CreateDate") for k in (r.get("AccessKeys", {}).get("AccessKey") or [])]))
