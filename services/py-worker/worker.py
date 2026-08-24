"""Minimal worker that genuinely uses each pinned dependency."""

import certifi
import requests
from flask import Flask, jsonify
from jinja2 import Template

app = Flask(__name__)

SUMMARY = Template("{{ name }} has {{ stars }} stars")


@app.get("/repos/<owner>/<repo>")
def repo_summary(owner: str, repo: str):
    response = requests.get(
        f"https://api.github.com/repos/{owner}/{repo}",
        timeout=5,
        verify=certifi.where(),
    )
    if response.status_code != 200:
        return jsonify(error="upstream failed"), 502

    data = response.json()
    return jsonify(
        summary=SUMMARY.render(name=data["full_name"], stars=data["stargazers_count"])
    )


if __name__ == "__main__":
    app.run(port=8081)
