#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <vector>
#include <algorithm>

// Very small “wow” tool: analyzes JSONL logs (one JSON object per line).
// It computes message count and approximate ciphertext size stats.
// In your portfolio, you can show you built observability & perf tooling too.

static long long approx_ct_bytes(const std::string& line) {
  // naive: look for `"ct":"..."`
  auto p = line.find("\"ct\"");
  if (p == std::string::npos) return 0;
  p = line.find(':', p);
  if (p == std::string::npos) return 0;
  p = line.find('"', p);
  if (p == std::string::npos) return 0;
  auto q = line.find('"', p + 1);
  if (q == std::string::npos) return 0;
  auto b64len = (long long)(q - (p + 1));
  // base64 approx bytes
  return (b64len * 3) / 4;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "usage: oplog_analyzer <jsonl_file>\n";
    return 2;
  }
  std::ifstream in(argv[1]);
  if (!in) {
    std::cerr << "failed to open " << argv[1] << "\n";
    return 2;
  }

  std::vector<long long> sizes;
  std::string line;
  long long n = 0;
  while (std::getline(in, line)) {
    n++;
    sizes.push_back(approx_ct_bytes(line));
  }
  if (n == 0) {
    std::cout << "empty log\n";
    return 0;
  }

  std::sort(sizes.begin(), sizes.end());
  auto pct = [&](double p) {
    size_t idx = (size_t)((p/100.0) * (sizes.size()-1));
    return sizes[idx];
  };

  long long sum = 0;
  for (auto s : sizes) sum += s;

  std::cout << "messages: " << n << "\n";
  std::cout << "ct_bytes avg: " << (sum / (double)n) << "\n";
  std::cout << "ct_bytes p50: " << pct(50) << "\n";
  std::cout << "ct_bytes p95: " << pct(95) << "\n";
  std::cout << "ct_bytes p99: " << pct(99) << "\n";
  return 0;
}