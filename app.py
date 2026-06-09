import os
import configparser
import urllib.request
import urllib.parse
import xml.etree.ElementTree as ET
from datetime import datetime
from flask import Flask, jsonify, request, render_template

app = Flask(__name__)

# Load API key from .env
config = configparser.ConfigParser()
config_path = os.path.join(os.path.dirname(__file__), '.env')
config.read(config_path)

try:
    API_KEY = config.get('APT', 'key')
except (configparser.NoSectionError, configparser.NoOptionError):
    API_KEY = os.environ.get('APT_KEY') or os.environ.get('API_KEY')

try:
    # 1. KAKAO 섹션의 js_key 우선 탐색
    KAKAO_MAP_API_KEY = config.get('KAKAO', 'js_key')
except (configparser.NoSectionError, configparser.NoOptionError):
    try:
        # 2. KAKAO 섹션의 key 탐색
        KAKAO_MAP_API_KEY = config.get('KAKAO', 'key')
    except (configparser.NoSectionError, configparser.NoOptionError):
        try:
            # 3. APT 섹션의 kakao_key 탐색
            KAKAO_MAP_API_KEY = config.get('APT', 'kakao_key')
        except (configparser.NoSectionError, configparser.NoOptionError):
            # 4. 환경변수 탐색
            KAKAO_MAP_API_KEY = os.environ.get('KAKAO_MAP_API_KEY') or os.environ.get('KAKAO_KEY') or os.environ.get('JS_KEY')


# Simple in-memory cache to save API request quotas
# Cache key: (lawd_cd, deal_ymd), Value: json data
api_cache = {}

def format_price_korean(price_raw):
    if price_raw >= 10000:
        uk = price_raw // 10000
        man = price_raw % 10000
        if man > 0:
            return f"{uk}억 {man:,}만 원"
        else:
            return f"{uk}억 원"
    else:
        return f"{price_raw:,}만 원"

def parse_xml_to_json(xml_content):
    current_year = datetime.now().year
    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError as e:
        return {"error": f"XML 파싱 에러: {str(e)}"}
    
    header = root.find("header")
    if header is not None:
        result_code = header.findtext("resultCode")
        result_msg = header.findtext("resultMsg")
        if result_code != "000":
            return {"error": f"공공데이터 API 에러: {result_msg} ({result_code})"}
            
    body = root.find("body")
    if body is None:
        return {"error": "API 응답에 바디 데이터가 없습니다."}
        
    items_node = body.find("items")
    if items_node is None:
        return {"items": [], "stats": {}}
        
    items = []
    for item in items_node.findall("item"):
        try:
            apt_name = (item.findtext("aptNm") or "").strip()
            dong = (item.findtext("umdNm") or item.findtext("aptDong") or "").strip()
            
            # Deal Amount
            amount_str = (item.findtext("dealAmount") or "0").replace(",", "").strip()
            price_raw = int(amount_str)
            price_formatted = format_price_korean(price_raw)
                
            # Area
            area_m2_str = item.findtext("excluUseAr") or "0"
            area_m2 = float(area_m2_str)
            area_pyeong = round(area_m2 / 3.3057, 1)
            
            # Floor
            floor = (item.findtext("floor") or "").strip()
            
            # Date
            year = (item.findtext("dealYear") or "").strip()
            month = (item.findtext("dealMonth") or "").strip()
            day = (item.findtext("dealDay") or "").strip()
            
            if month.isdigit():
                month = month.zfill(2)
            if day.isdigit():
                day = day.zfill(2)
                
            deal_date = f"{year}-{month}-{day}" if year and month and day else f"{year}-{month}"
            
            # Build Year & Age
            build_year_str = item.findtext("buildYear") or ""
            build_year = int(build_year_str) if build_year_str.isdigit() else 0
            building_age = current_year - build_year if build_year > 0 else 0
            
            # Dealing type & Agent Location
            deal_type = (item.findtext("dealingGbn") or "").strip()
            agent_location = (item.findtext("estateAgentSggNm") or "").strip()
            
            items.append({
                "apt_name": apt_name,
                "dong": dong,
                "price_raw": price_raw,
                "price_formatted": price_formatted,
                "area_m2": area_m2,
                "area_pyeong": area_pyeong,
                "floor": floor,
                "deal_date": deal_date,
                "build_year": build_year,
                "building_age": building_age,
                "deal_type": deal_type,
                "agent_location": agent_location
            })
        except Exception as item_err:
            print(f"Error parsing item: {item_err}")
            continue
            
    # Sort items by date descending, then price descending
    items.sort(key=lambda x: (x["deal_date"], x["price_raw"]), reverse=True)
    
    # Calculate statistics
    stats = {}
    if items:
        prices = [x["price_raw"] for x in items]
        avg_price = sum(prices) / len(prices)
        max_item = max(items, key=lambda x: x["price_raw"])
        min_item = min(items, key=lambda x: x["price_raw"])
        
        stats = {
            "total_count": len(items),
            "avg_price_raw": avg_price,
            "avg_price_formatted": format_price_korean(int(avg_price)),
            "max_price_raw": max_item["price_raw"],
            "max_price_formatted": max_item["price_formatted"],
            "max_apt": max_item["apt_name"],
            "max_dong": max_item["dong"],
            "min_price_raw": min_item["price_raw"],
            "min_price_formatted": min_item["price_formatted"],
            "min_apt": min_item["apt_name"],
            "min_dong": min_item["dong"]
        }
        
    return {"items": items, "stats": stats}

@app.route("/")
def index():
    return render_template("index.html", kakao_key=KAKAO_MAP_API_KEY)

@app.route("/api/sigungu")
def get_sigungu():
    # Read sigungu.json file and return it
    try:
        sigungu_path = os.path.join(os.path.dirname(__file__), 'sigungu.json')
        with open(sigungu_path, 'r', encoding='utf-8') as f:
            import json
            data = json.load(f)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": f"지역 정보를 읽어오는 중 에러 발생: {str(e)}"}), 500

@app.route("/api/transactions")
def get_transactions():
    if not API_KEY:
        return jsonify({"error": ".env 파일에 API 키가 설정되지 않았습니다."}), 400
        
    lawd_cd = request.args.get("lawd_cd")
    deal_ymd = request.args.get("deal_ymd")
    
    if not lawd_cd or not deal_ymd:
        return jsonify({"error": "lawd_cd와 deal_ymd는 필수 파라미터입니다."}), 400
        
    # Clear invalid letters from month input (e.g., hyphens in '2024-03' -> '202403')
    deal_ymd = deal_ymd.replace("-", "").strip()
    
    # Check cache
    cache_key = (lawd_cd, deal_ymd)
    if cache_key in api_cache:
        print(f"Serving from cache: {cache_key}")
        return jsonify(api_cache[cache_key])
        
    # Call Public Data API
    url = "http://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade"
    params = {
        "serviceKey": API_KEY,
        "LAWD_CD": lawd_cd,
        "DEAL_YMD": deal_ymd
    }
    
    query_string = urllib.parse.urlencode(params)
    full_url = f"{url}?{query_string}"
    
    try:
        req = urllib.request.Request(full_url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=15) as response:
            xml_data = response.read()
            
        json_data = parse_xml_to_json(xml_data)
        
        # Cache results if there is no error
        if "error" not in json_data:
            api_cache[cache_key] = json_data
            
        return jsonify(json_data)
        
    except urllib.error.URLError as e:
        return jsonify({"error": f"네트워크 통신 오류가 발생했습니다: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": f"서버 처리 오류: {str(e)}"}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)
