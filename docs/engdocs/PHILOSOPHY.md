# Philosophy

Devs would rarely use a global npm package for a project, it belongs in the package.json; same for any software ecosystem. Skills shouldn't be different, allowing for a few truly personal changes.

Even worse, skills are prose, not code, so it's hard to enforce and understand exactly what an agent will do with them.

Skillbox aims for transparency and convenience. Users can't all author skills and maintain that over multiple repos. Many users simply want a reputable skill, but then how do they tweak it just a little bit?

Skillbox keeps the skills in the repo, with minimal fuss but full transparency via config and lockfile. Sync should be a command away, patching should be handled and versioned without throwing away the original author's good work.

Missconfigurations fails loudly and conflicts surface clearly.

Tool is agent first, all responses clear and concise json with progressive disclosure to expand details ad-hoc. No hidden errors or status codes, use clear success: true|false with errors clearly in the json. Return partial data where possible
