#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Web Search Tool - Python Backend
"""

import sys
import json
import asyncio
import aiohttp
import random
import urllib.parse
from typing import List, Dict, Any
from dataclasses import dataclass
from bs4 import BeautifulSoup

# 常量定义
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 6.1; rv:84.0) Gecko/20100101 Firefox/84.0",
    "Accept": "*/*",
    "Connection": "keep-alive",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
}

USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:88.0) Gecko/20100101 Firefox/88.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:89.0) Gecko/20100101 Firefox/89.0",
]

@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str

class WebSearcher:
    def __init__(self, preferred_engines=None):
        self.timeout = 10
        self.headers = HEADERS.copy()
        # 默认搜索引擎顺序：Bing -> Google -> sogou
        self.preferred_engines = preferred_engines or ["bing", "google", "sogou"]

    def tidy_text(self, text: str) -> str:
        """清理文本，去除空格、换行符等"""
        if not text:
            return ""
        return text.strip().replace("\n", " ").replace("\r", " ").replace("  ", " ")

    async def get_html(self, url: str, data: dict = None) -> str:
        """获取网页HTML内容"""
        headers = self.headers.copy()
        headers["Referer"] = url
        headers["User-Agent"] = random.choice(USER_AGENTS)
        
        async with aiohttp.ClientSession(trust_env=True) as session:
            try:
                if data:
                    async with session.post(url, headers=headers, data=data, timeout=self.timeout) as resp:
                        return await resp.text(encoding="utf-8")
                else:
                    async with session.get(url, headers=headers, timeout=self.timeout) as resp:
                        return await resp.text(encoding="utf-8")
            except Exception as e:
                raise Exception(f"Failed to fetch {url}: {str(e)}")

    async def get_from_url(self, url: str) -> str:
        """获取网页内容并清理"""
        try:
            header = self.headers.copy()
            header.update({"User-Agent": random.choice(USER_AGENTS)})
            
            async with aiohttp.ClientSession(trust_env=True) as session:
                async with session.get(url, headers=header, timeout=6) as response:
                    html = await response.text(encoding="utf-8")
                    
                    # 简单的内容提取（模拟readability功能）
                    soup = BeautifulSoup(html, "html.parser")
                    
                    # 移除脚本和样式
                    for script in soup(["script", "style"]):
                        script.decompose()
                    
                    # 尝试获取主要内容
                    main_content = soup.find("main") or soup.find("article") or soup.find("div", class_="content") or soup.body
                    if main_content:
                        text = main_content.get_text()
                    else:
                        text = soup.get_text()
                    
                    return self.tidy_text(text)
        except Exception:
            return ""

    async def search_google(self, query: str, num_results: int) -> List[SearchResult]:
        """Google搜索 - 使用googlesearch库的逻辑"""
        results = []
        try:
            # 尝试导入googlesearch库
            try:
                from googlesearch import search
                import asyncio
                from concurrent.futures import ThreadPoolExecutor
                
                def _google_search_sync():
                    # 使用基本搜索模式，返回URL列表
                    return list(search(
                        query,
                        num_results=num_results,
                        lang='zh-CN',
                        timeout=3,  # 减少超时时间
                        sleep_interval=0.5,  # 减少等待间隔
                        safe='off'  # 关闭安全搜索以获得更多结果
                    ))
                
                # 在线程池中异步执行同步的Google搜索
                with ThreadPoolExecutor() as executor:
                    search_results = await asyncio.wait_for(
                        asyncio.get_event_loop().run_in_executor(executor, _google_search_sync),
                        timeout=10.0  # 10秒总超时
                    )
                
                # 将URL转换为SearchResult对象
                for i, url in enumerate(search_results):
                    if i >= num_results:
                        break
                    results.append(SearchResult(
                        title=f"Google搜索结果 {i+1}",
                        url=url,
                        snippet=""
                    ))
                    
            except (ImportError, asyncio.TimeoutError) as e:
                # 如果没有googlesearch库或超时，使用备用方法
                print(f"Google search library failed ({e}), trying fallback method", file=sys.stderr)
                results = await self.search_google_fallback(query, num_results)
                
        except Exception as e:
            print(f"Google search error: {e}", file=sys.stderr)
            # 尝试备用方法
            try:
                results = await self.search_google_fallback(query, num_results)
            except Exception:
                pass
            
        return results

    async def search_google_fallback(self, query: str, num_results: int) -> List[SearchResult]:
        """Google搜索备用方法"""
        results = []
        try:
            google_urls = [
                "https://www.google.com/search",
                "https://www.google.com.hk/search",
            ]
            
            for base_url in google_urls:
                try:
                    search_url = f"{base_url}?q={urllib.parse.quote(query)}&num={num_results}&hl=zh-CN"
                    html = await self.get_html(search_url)
                    
                    soup = BeautifulSoup(html, "html.parser")
                    
                    # 解析搜索结果
                    for item in soup.find_all("div", class_="yuRUbf")[:num_results]:
                        link_elem = item.find("a")
                        title_elem = item.find("h3")
                        
                        if link_elem and title_elem:
                            url = link_elem.get("href")
                            title = title_elem.get_text()
                            
                            # 寻找描述
                            snippet = ""
                            parent = item.find_parent()
                            if parent:
                                desc_elem = parent.find("div", class_="VwiC3b")
                                if desc_elem:
                                    snippet = desc_elem.get_text()
                            
                            if url and title and not url.startswith('/'):
                                results.append(SearchResult(
                                    title=self.tidy_text(title),
                                    url=url,
                                    snippet=self.tidy_text(snippet)
                                ))
                    
                    if results:
                        break
                        
                except Exception as e:
                    continue
                    
        except Exception as e:
            print(f"Google fallback search error: {e}", file=sys.stderr)
            
        return results

    async def search_bing(self, query: str, num_results: int) -> List[SearchResult]:
        """Bing搜索"""
        results = []
        try:
            bing_urls = ["https://cn.bing.com", "https://www.bing.com"]
            
            for base_url in bing_urls:
                try:
                    search_url = f"{base_url}/search?q={urllib.parse.quote(query)}"
                    html = await self.get_html(search_url)
                    
                    soup = BeautifulSoup(html, "html.parser")
                    
                    # 解析Bing搜索结果
                    for item in soup.find_all("li", class_="b_algo")[:num_results]:
                        title_elem = item.find("h2")
                        if title_elem:
                            link_elem = title_elem.find("a")
                            if link_elem:
                                url = link_elem.get("href")
                                title = link_elem.get_text()
                                
                                # 获取描述
                                snippet = ""
                                desc_elem = item.find("p") or item.find("div", class_="b_caption")
                                if desc_elem:
                                    snippet = desc_elem.get_text()
                                
                                if url and title:
                                    results.append(SearchResult(
                                        title=self.tidy_text(title),
                                        url=url,
                                        snippet=self.tidy_text(snippet)
                                    ))
                    
                    if results:
                        break
                        
                except Exception as e:
                    continue
                    
        except Exception as e:
            print(f"Bing search error: {e}", file=sys.stderr)
            
        return results

    async def search_sogou(self, query: str, num_results: int) -> List[SearchResult]:
        """搜狗搜索"""
        results = []
        try:
            search_url = f"https://www.sogou.com/web?query={urllib.parse.quote(query)}"
            html = await self.get_html(search_url)
            
            soup = BeautifulSoup(html, "html.parser")
            
            # 解析搜狗搜索结果
            for item in soup.find_all("div", class_="vrwrap")[:num_results]:
                if "middle-better-hintBox" in str(item):
                    continue
                    
                title_elem = item.find("h3")
                if title_elem:
                    link_elem = title_elem.find("a")
                    if link_elem:
                        url = link_elem.get("href")
                        title = link_elem.get_text()
                        
                        # 处理重定向链接
                        if url and url.startswith("/link?"):
                            url = "https://www.sogou.com" + url
                        
                        snippet = ""  # 搜狗的描述比较复杂，暂时留空
                        
                        if url and title:
                            results.append(SearchResult(
                                title=self.tidy_text(title),
                                url=url,
                                snippet=snippet
                            ))
                            
        except Exception as e:
            print(f"Sogou search error: {e}", file=sys.stderr)
            
        return results

    async def web_search_default(self, query: str, num_results: int = 5) -> List[SearchResult]:
        """默认搜索方法，按配置的顺序尝试搜索引擎"""
        results = []
        
        # 搜索引擎映射
        engine_map = {
            "google": ("Google", self.search_google),
            "bing": ("Bing", self.search_bing),
            "sogou": ("Sogou", self.search_sogou)
        }
        
        # 按照配置的顺序尝试搜索引擎
        for engine_key in self.preferred_engines:
            if engine_key not in engine_map:
                continue
                
            engine_name, search_func = engine_map[engine_key]
            try:
                print(f"Trying {engine_name} search for: {query}", file=sys.stderr)
                results = await search_func(query, num_results)
                if results:
                    print(f"Found {len(results)} results using {engine_name}", file=sys.stderr)
                    return results
                else:
                    print(f"{engine_name} returned no results", file=sys.stderr)
            except Exception as e:
                print(f"{engine_name} search failed: {e}", file=sys.stderr)
                continue
        
        print("All search engines failed or returned no results", file=sys.stderr)
        return results

    async def process_search_result(self, result: SearchResult, index: int) -> Dict[str, Any]:
        """处理单个搜索结果"""
        print(f"Processing result {index}: {result.title} - {result.url}", file=sys.stderr)
        
        site_content = ""
        try:
            site_content = await self.get_from_url(result.url)
        except Exception as e:
            print(f"Failed to fetch content from {result.url}: {e}", file=sys.stderr)
        
        # 限制内容长度
        if len(site_content) > 700:
            site_content = site_content[:700] + "..."
        
        return {
            "index": index,
            "title": result.title,
            "url": result.url,
            "snippet": result.snippet,
            "content": site_content
        }

    async def search(self, query: str, max_results: int = 5) -> Dict[str, Any]:
        """主搜索方法"""
        try:
            # 获取搜索结果
            results = await self.web_search_default(query, max_results)
            
            if not results:
                return {
                    "success": False,
                    "error": "No search results found",
                    "query": query,
                    "results": []
                }
            
            # 处理搜索结果
            processed_results = []
            for i, result in enumerate(results, 1):
                processed_result = await self.process_search_result(result, i)
                processed_results.append(processed_result)
            
            return {
                "success": True,
                "query": query,
                "total_results": len(results),
                "processed_results": len(processed_results),
                "results": processed_results
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "query": query,
                "results": []
            }

async def main():
    """主函数"""
    try:
        # 从stdin读取JSON输入
        input_data = sys.stdin.read()
        if not input_data.strip():
            raise ValueError("No input data provided")
        
        # 确保正确处理UTF-8编码
        if isinstance(input_data, str):
            input_data = input_data.encode('utf-8').decode('utf-8')
        
        params = json.loads(input_data)
        query = params.get("query", "").strip()
        max_results = params.get("max_results", 5)
        
        if not query:
            raise ValueError("Query parameter is required")
        
        if not isinstance(max_results, int) or max_results < 1 or max_results > 20:
            max_results = 5
        
        # 执行搜索
        searcher = WebSearcher()
        result = await searcher.search(query, max_results)
        
        # 输出JSON结果，确保中文字符正确显示
        print(json.dumps(result, ensure_ascii=False, indent=2))
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e),
            "query": "",
            "results": []
        }
        print(json.dumps(error_result, ensure_ascii=False, indent=2))
        sys.exit(1)

if __name__ == "__main__":
    # 检查依赖
    try:
        import aiohttp
        import bs4
    except ImportError as e:
        error_result = {
            "success": False,
            "error": f"Missing required Python package: {e.name}. Please install with: pip install {e.name}",
            "dependency_error": True,
            "query": "",
            "results": []
        }
        print(json.dumps(error_result, ensure_ascii=False, indent=2))
        sys.exit(1)
    
    asyncio.run(main())