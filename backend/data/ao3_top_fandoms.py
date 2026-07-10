"""Top AO3 fandoms — seed data for the heuristic fandom classifier.

Each key is the fandom's canonical name **as AO3 uses it** (see
https://archiveofourown.org/wrangling). The list of strings is a small set
of distinctive lowercase aliases used by `classify_by_metadata` for keyword
matching — character names, locations, in-universe terminology that's
unlikely to appear in any other fandom.

This file is merged into `FANDOM_KEYWORDS` at import time in `routes/books.py`.
Existing manually-curated keys in `FANDOM_KEYWORDS` win the merge, so updating
this file never overrides hand-tuned entries.

When adding new fandoms:
  * Use AO3's exact canonical form (parentheticals, " - Author Name" suffix,
    media-type qualifier, etc.) — this is how the shelves will be labelled.
  * Keep aliases narrow. Avoid generic single words ("game", "movie") and
    avoid character names that overlap other fandoms ("john" alone is
    useless — `"john sheppard"` is fine).
  * 4-8 aliases per fandom is a sweet spot. More than that risks false
    positives via cross-fandom name collisions.
"""

from typing import Dict, List


AO3_TOP_FANDOMS: Dict[str, List[str]] = {
    # ─────────────────────────────────────────────────────────────────
    # ANIME & MANGA
    # ─────────────────────────────────────────────────────────────────
    "Haikyuu!!": ["haikyuu", "haikyu", "shoyo hinata", "kageyama tobio", "tsukishima kei", "karasuno", "nekoma", "oikawa tooru"],
    "進撃の巨人 | Shingeki no Kyojin | Attack on Titan": ["attack on titan", "shingeki no kyojin", "eren yeager", "eren jaeger", "mikasa ackerman", "armin arlert", "levi ackerman", "survey corps", "titan shifter"],
    "Kimetsu no Yaiba | Demon Slayer": ["demon slayer", "kimetsu no yaiba", "tanjiro kamado", "nezuko kamado", "zenitsu agatsuma", "inosuke hashibira", "muzan kibutsuji", "hashira"],
    "呪術廻戦 | Jujutsu Kaisen": ["jujutsu kaisen", "yuji itadori", "megumi fushiguro", "nobara kugisaki", "satoru gojo", "sukuna", "jujutsu high"],
    "One Piece": ["one piece fic", "monkey d luffy", "roronoa zoro", "going merry", "thousand sunny", "straw hat pirates", "nico robin", "trafalgar law"],
    "Bleach": ["bleach fanfic", "ichigo kurosaki", "rukia kuchiki", "soul society", "zanpakuto", "byakuya kuchiki", "kenpachi"],
    "Death Note (Anime & Manga)": ["death note", "light yagami", "kira investigation", "ryuk", "shinigami realm", "l lawliet", "near and mello"],
    "Fullmetal Alchemist - All Media Types": ["fullmetal alchemist", "edward elric", "alphonse elric", "roy mustang", "amestris", "philosopher's stone", "homunculus"],
    "Hunter X Hunter": ["hunter x hunter", "gon freecss", "killua zoldyck", "kurapika", "leorio paladiknight", "nen ability", "hunter exam"],
    "Yuri!!! on Ice": ["yuri on ice", "yuuri katsuki", "victor nikiforov", "yuri plisetsky", "grand prix final", "figure skating fic"],
    "Banana Fish": ["banana fish", "ash lynx", "eiji okumura", "shorter wong", "blanca lobo"],
    "東京卍リベンジャーズ | Tokyo Revengers": ["tokyo revengers", "takemichi hanagaki", "mikey sano", "draken ryuguji", "tokyo manji gang"],
    "文豪ストレイドッグス | Bungou Stray Dogs": ["bungou stray dogs", "armed detective agency", "osamu dazai", "atsushi nakajima", "port mafia", "chuuya nakahara"],
    "美少女戦士セーラームーン | Bishoujo Senshi Sailor Moon": ["sailor moon fic", "usagi tsukino", "tuxedo mask", "moon kingdom", "sailor senshi", "silver crystal"],
    "犬夜叉 | InuYasha": ["inuyasha fic", "kagome higurashi", "feudal era", "shikon jewel", "sesshomaru", "sengoku jidai"],
    "ドラゴンボール | Dragon Ball - All Media Types": ["dragon ball", "son goku", "vegeta saiyan", "kamehameha", "saiyan prince", "namekian", "dragon radar"],
    "One Punch Man": ["one punch man", "saitama opm", "genos cyborg", "tatsumaki", "hero association"],
    "モブサイコ100 | Mob Psycho 100": ["mob psycho 100", "shigeo kageyama", "reigen arataka", "claw esper", "psychic mob"],
    "魔道祖师 - 墨香铜臭 | Módào Zǔshī - Mòxiāng Tóngxiù": ["mo dao zu shi", "modao zushi", "wei wuxian", "lan wangji", "yiling laozu", "cloud recesses", "wangxian"],
    "天官赐福 - 墨香铜臭 | Tiān Guān Cì Fú - Mòxiāng Tóngxiù": ["heaven officials blessing", "tian guan ci fu", "tgcf", "xie lian", "hua cheng", "san lang", "ghost king"],

    # ─────────────────────────────────────────────────────────────────
    # BOOKS & LITERATURE
    # ─────────────────────────────────────────────────────────────────
    "A Song of Ice and Fire - George R. R. Martin": ["a song of ice and fire", "asoiaf", "george rr martin", "westeros books", "the iron throne"],  # GoT TV is separate
    "The Witcher - Andrzej Sapkowski": ["witcher books", "andrzej sapkowski", "geralt of rivia", "yennefer of vengerberg", "ciri cirilla", "kaer morhen"],
    "The Folk of the Air Series - Holly Black": ["folk of the air", "cruel prince", "jude duarte", "cardan greenbriar", "high court of faerie", "holly black"],
    "Six of Crows Series - Leigh Bardugo": ["six of crows", "kaz brekker", "inej ghafa", "ketterdam", "dregs gang", "leigh bardugo"],
    "Shadow and Bone Trilogy - Leigh Bardugo": ["shadow and bone", "grishaverse", "alina starkov", "the darkling", "ravka", "little palace"],
    "A Court of Thorns and Roses - Sarah J. Maas": ["court of thorns and roses", "acotar", "feyre archeron", "rhysand high lord", "night court", "spring court"],
    "Throne of Glass - Sarah J. Maas": ["throne of glass", "aelin galathynius", "celaena sardothien", "rowan whitethorn", "terrasen", "sarah j maas"],
    "Shadowhunter Chronicles - Cassandra Clare": ["shadowhunters books", "cassandra clare", "jace herondale", "alec lightwood", "magnus bane", "institute clave"],
    "Good Omens (TV)": ["good omens tv", "aziraphale and crowley", "neil gaiman terry", "agnes nutter", "antichrist adam", "ineffable"],
    "Discworld - Terry Pratchett": ["discworld", "terry pratchett", "ankh-morpork", "rincewind", "sam vimes", "death of discworld", "granny weatherwax"],
    "The Dresden Files - Jim Butcher": ["dresden files", "harry dresden", "jim butcher", "white council", "winter court", "chicago wizard"],
    "His Dark Materials - Philip Pullman": ["his dark materials", "lyra belacqua", "lyra silvertongue", "pantalaimon", "philip pullman", "magisterium"],
    "Mistborn Series - Brandon Sanderson": ["mistborn", "brandon sanderson", "vin allomancer", "kelsier", "luthadel", "scadrial"],
    "The Stormlight Archive - Brandon Sanderson": ["stormlight archive", "kaladin stormblessed", "shallan davar", "dalinar kholin", "roshar"],

    # ─────────────────────────────────────────────────────────────────
    # MOVIES (AO3 uses "(Movies)" suffix for film canon)
    # ─────────────────────────────────────────────────────────────────
    "Marvel Cinematic Universe": ["mcu fic", "marvel cinematic universe", "earth-199999", "infinity saga", "post-endgame", "tva loki"],
    "The Avengers (Marvel Movies)": ["avengers fic", "stucky", "steve/bucky", "winter soldier bucky", "stony stark", "shieldhusbands"],
    "Captain America (Movies)": ["captain america movies", "bucky barnes", "winter soldier", "steve rogers", "shield agent", "sam wilson falcon"],
    "Iron Man (Movies)": ["iron man movies", "tony stark mcu", "pepper potts", "happy hogan", "stark industries", "j.a.r.v.i.s."],
    "Thor (Movies)": ["thor movies", "thor odinson", "loki laufeyson", "asgard movies", "mjolnir", "ragnarok"],
    "Spider-Man: Homecoming (2017)": ["spider-man homecoming", "peter parker mcu", "ned leeds", "michelle jones mj", "midtown high"],
    "Pirates of the Caribbean (Movies)": ["pirates of the caribbean", "jack sparrow", "will turner", "elizabeth swann", "black pearl", "hector barbossa"],
    "DCU (Movies)": ["dceu", "dc extended universe", "snyderverse", "henry cavill superman", "ben affleck batman"],
    "The Hobbit (Jackson Movies)": ["the hobbit movies", "bilbo baggins", "thorin oakenshield", "dwarves of erebor", "smaug dragon", "bagginshield"],
    "Lord of the Rings (Movies)": ["lord of the rings movies", "fellowship of the ring", "aragorn elessar", "legolas greenleaf", "gimli son"],
    "Star Wars - All Media Types": ["star wars universe", "obi-wan kenobi", "anakin skywalker", "luke skywalker", "leia organa", "han solo", "the force"],
    "Star Wars: The Clone Wars (2008) - All Media Types": ["clone wars", "ahsoka tano", "captain rex", "commander cody", "501st legion", "clone troopers"],
    "Star Wars Sequel Trilogy": ["star wars sequels", "kylo ren", "rey skywalker", "finn fn-2187", "poe dameron", "the resistance"],
    "The Princess Bride (1987)": ["princess bride", "westley dread pirate", "buttercup", "inigo montoya", "vizzini fezzik"],

    # ─────────────────────────────────────────────────────────────────
    # TV SHOWS
    # ─────────────────────────────────────────────────────────────────
    "Merlin (TV)": ["merlin tv", "arthur pendragon", "merlin emrys", "camelot court", "morgana le fay", "gwen pendragon", "merthur"],
    "Sherlock (TV)": ["bbc sherlock", "johnlock", "sherlock holmes bbc", "john watson army", "mycroft holmes", "moriarty bbc", "221b"],
    "Buffy the Vampire Slayer": ["buffy the vampire slayer", "buffy summers", "willow rosenberg", "spike vampire", "sunnydale", "scooby gang"],
    "Star Trek: Alternate Original Series (AOS) - Fandom": ["star trek aos", "star trek 2009", "spirk", "kirk spock", "enterprise nx", "vulcan spock"],
    "Star Trek: The Original Series": ["star trek tos", "captain kirk", "spock prime", "leonard mccoy", "uss enterprise tos"],
    "Star Trek: The Next Generation": ["star trek tng", "jean-luc picard", "william riker", "lieutenant data", "deanna troi", "geordi la forge"],
    "Star Trek: Deep Space Nine": ["deep space nine", "ds9 fic", "benjamin sisko", "kira nerys", "jadzia dax", "garak bashir"],
    "Star Trek: Voyager": ["star trek voyager", "kathryn janeway", "seven of nine", "uss voyager", "tom paris", "tuvok"],
    "Hannibal (TV)": ["hannibal tv", "hannigram", "will graham", "hannibal lecter", "bryan fuller", "jack crawford", "hannibal nbc", "will graham profiler", "hannibal lecter chesapeake"],
    "Brooklyn Nine-Nine (TV)": ["brooklyn nine-nine", "jake peralta", "amy santiago", "terry jeffords", "rosa diaz", "raymond holt"],
    "Bridgerton (TV)": ["bridgerton", "anthony bridgerton", "kate sharma", "daphne bridgerton", "simon basset", "regency london"],
    "Downton Abbey": ["downton abbey", "lord grantham", "lady mary crawley", "lady edith", "carson butler", "thomas barrow"],
    "陈情令 | The Untamed (TV)": ["the untamed", "wei wuxian live action", "lan zhan", "xiao zhan", "wang yibo", "chen qing ling"],
    "Schitt's Creek": ["schitt's creek", "david rose", "patrick brewer", "moira rose", "alexis rose", "rosebud motel"],
    "Killing Eve (TV)": ["killing eve", "villaneve", "eve polastri", "villanelle", "carolyn martens"],
    "Stranger Things (TV 2016)": ["stranger things", "hawkins indiana", "eleven jane hopper", "mike wheeler", "the upside down", "byler", "steddie", "eddie munson"],
    "Our Flag Means Death (TV)": ["our flag means death", "stede bonnet", "blackbeard ed", "izzy hands", "gentleman pirate"],
    "Heartstopper (TV)": ["heartstopper", "nick nelson", "charlie spring", "tao xu", "elle argent", "alice oseman"],
    "9-1-1 (TV)": ["9-1-1 tv", "buddie", "evan buckley", "eddie diaz", "118 station", "athena grant"],
    "Glee": ["glee tv", "kurt hummel", "blaine anderson", "klaine", "new directions", "william mckinley high"],
    "Wednesday (TV 2022)": ["wednesday addams series", "nevermore academy", "enid sinclair", "wednesday and enid", "wenclair"],
    "The Witcher (TV)": ["witcher netflix", "geralt of rivia netflix", "jaskier dandelion", "yennefer netflix", "cintra"],
    # NCIS franchise — each spin-off shelved separately. Aliases lean on
    # cast/setting that's unique to each show so e.g. an NCIS:LA fic
    # doesn't land on the main NCIS shelf.
    "NCIS": ["ncis fic", "leroy jethro gibbs", "anthony dinozzo", "tony dinozzo", "ziva david", "tim mcgee", "abby sciuto", "ducky mallard", "ncis dc", "tibbs", "tony/gibbs"],
    "NCIS: Los Angeles": ["ncis los angeles", "ncis la", "g callen", "sam hanna", "marty deeks", "kensi blye", "hetty lange", "densi", "office of special projects"],
    "NCIS: New Orleans": ["ncis new orleans", "ncis nola", "dwayne pride", "christopher lasalle", "meredith brody", "sebastian lund", "tammy gregorio"],
    "NCIS: Hawai'i": ["ncis hawaii", "ncis hawai'i", "jane tennant", "lucy tara", "kate whistler", "jesse boone", "kaisani kai", "kacy", "pearl harbor ncis"],
    "NCIS: Sydney": ["ncis sydney", "michelle mackey", "jd dempsey", "evie cooper", "blue james", "rosie mahoney", "afp", "australian federal police ncis"],
    "NCIS: Origins": ["ncis origins", "young gibbs", "mike franks", "camp pendleton ncis", "leroy gibbs origins", "ncis prequel", "1991 ncis"],
    "NCIS: Tony & Ziva": ["tony and ziva", "tony & ziva", "tali dinozzo", "tiva", "paris ncis", "ziva david europe"],

    # ─────────────────────────────────────────────────────────────────
    # CARTOONS / ANIMATION (Western)
    # ─────────────────────────────────────────────────────────────────
    "Avatar: The Last Airbender": ["avatar the last airbender", "atla", "aang avatar", "katara waterbender", "sokka", "toph beifong", "fire lord zuko", "zukka"],
    "The Legend of Korra": ["legend of korra", "avatar korra", "asami sato", "korrasami", "republic city", "mako bolin"],
    "Voltron: Legendary Defender": ["voltron legendary defender", "klance", "keith and lance", "shiro paladin", "pidge gunderson", "hunk garrett"],
    "Steven Universe": ["steven universe", "crystal gems", "garnet ruby sapphire", "pearl amethyst", "rose quartz", "beach city"],
    "Gravity Falls": ["gravity falls", "dipper pines", "mabel pines", "stanford pines", "bill cipher", "mystery shack"],
    "She-Ra and the Princesses of Power (2018)": ["she-ra and the princesses", "adora etheria", "catra she-ra", "catradora", "princess alliance", "horde"],
    "Encanto (2021)": ["encanto", "madrigal family", "mirabel madrigal", "bruno madrigal", "casita", "we don't talk about bruno"],

    # ─────────────────────────────────────────────────────────────────
    # VIDEO GAMES
    # ─────────────────────────────────────────────────────────────────
    "The Legend of Zelda - All Media Types": ["legend of zelda", "loz fic", "hyrule kingdom", "princess zelda", "link hero", "master sword", "ganondorf"],
    "The Legend of Zelda: Breath of the Wild": ["breath of the wild", "botw", "link botw", "zelda botw", "calamity ganon", "sheikah slate"],
    "Final Fantasy VII": ["final fantasy 7", "ffvii fic", "cloud strife", "sephiroth", "tifa lockhart", "aerith gainsborough", "midgar"],
    "Final Fantasy XIV Online": ["final fantasy 14", "ffxiv fic", "warrior of light", "eorzea", "scions of the seventh dawn", "primal"],
    "Final Fantasy XV": ["final fantasy 15", "ffxv fic", "noctis lucis caelum", "prompto argentum", "ignis scientia", "gladiolus amicitia"],
    "Pokemon - All Media Types": ["pokemon fic", "trainer ash", "pokemon master", "pikachu trainer", "professor oak", "kanto johto"],
    "Mass Effect Trilogy": ["mass effect", "commander shepard", "garrus vakarian", "tali zorah", "normandy sr-2", "reapers", "council races"],
    "Dragon Age - All Media Types": ["dragon age", "thedas", "grey wardens", "templars and mages", "fereldan", "warden inquisitor"],
    "Dragon Age: Inquisition": ["dragon age inquisition", "the inquisitor", "skyhold", "solas dread wolf", "cullen rutherford", "dorian pavus"],
    "原神 | Genshin Impact (Video Game)": ["genshin impact", "teyvat", "traveler aether lumine", "venti barbatos", "zhongli morax", "raiden shogun", "klee", "diluc kaeya"],
    "崩坏：星穹铁道 | Honkai: Star Rail (Video Game)": ["honkai star rail", "trailblazer", "astral express", "stelle caelus", "march 7th"],
    "Fire Emblem: Three Houses": ["fire emblem three houses", "garreg mach monastery", "byleth eisner", "edelgard", "dimitri blaiddyd", "claude von riegan", "black eagles"],
    "Fire Emblem Series - All Media Types": ["fire emblem", "tactician fic", "fire emblem fates", "fire emblem awakening", "robin tactician"],
    "The Elder Scrolls V: Skyrim": ["skyrim", "dragonborn", "tamriel skyrim", "thieves guild", "dark brotherhood", "whiterun"],
    "Detroit: Become Human (Video Game)": ["detroit become human", "connor rk800", "hank anderson", "markus android", "kara alice", "androids deviant"],
    "Persona 5": ["persona 5", "phantom thieves", "joker akira", "akira kurusu", "ren amamiya", "ryuji sakamoto", "ann takamaki"],
    "Persona Series": ["persona series fic", "persona 4", "persona 3", "shadow operatives", "tatsumi port island"],
    "Overwatch (Video Game)": ["overwatch fic", "tracer lena", "widowmaker", "reaper gabriel", "soldier 76", "talon overwatch"],
    "Undertale (Video Game)": ["undertale", "frisk undertale", "sans skeleton", "papyrus skeleton", "underground monsters", "determination"],
    "Hades (Video Game 2018)": ["hades video game", "zagreus prince", "supergiant games", "house of hades", "thanatos zagreus", "megaera"],
    "Baldur's Gate 3": ["baldurs gate 3", "bg3 fic", "tav the player", "astarion ancunin", "shadowheart", "karlach githyanki", "the absolute"],
    "Hollow Knight (Video Game)": ["hollow knight", "hallownest", "the knight protagonist", "pale king", "void hollow", "deepnest"],
    "League of Legends": ["league of legends", "summoner's rift", "champion league", "runeterra", "ionia noxus"],
    "Cyberpunk 2077 (Video Game)": ["cyberpunk 2077", "night city v", "johnny silverhand", "samurai relic", "merc fic"],
    "Disco Elysium (Video Game)": ["disco elysium", "harry du bois", "kim kitsuragi", "revachol"],

    # ─────────────────────────────────────────────────────────────────
    # RPF (Real Person Fiction)
    # ─────────────────────────────────────────────────────────────────
    "5SOS (Band)": ["5 seconds of summer", "luke hemmings", "michael clifford", "calum hood", "ashton irwin"],
    "방탄소년단 | Bangtan Boys | BTS": ["bts members", "min yoongi suga", "jeon jungkook", "kim taehyung", "park jimin", "kim namjoon", "kim seokjin", "jung hoseok"],
    "SEVENTEEN (Band)": ["seventeen kpop", "svt fic", "jeonghan choi", "joshua hong", "vernon hansol", "carat", "pledis"],
    "Stray Kids (Band)": ["stray kids", "bang chan", "lee felix", "hwang hyunjin", "han jisung", "skz fic", "stay fandom"],
    "ATEEZ (Band)": ["ateez kpop", "kim hongjoong", "park seonghwa", "jeong yunho", "atiny"],
    "ENHYPEN (Band)": ["enhypen kpop", "lee heeseung", "park jongseong jay", "engene"],
    "TWICE (Band)": ["twice kpop", "nayeon twice", "mina sharon", "dahyun twice", "once fandom"],
    "BLACKPINK (Band)": ["blackpink kpop", "jennie kim", "jisoo kim", "rose blackpink", "lisa manoban", "blink"],
    "F1 RPF": ["formula 1 rpf", "f1 rpf", "lewis hamilton", "max verstappen", "lestappen", "carlos sainz jr", "charles leclerc"],
    "Taylor Swift (Musician)": ["taylor swift fic", "the eras tour", "tay swift", "kaylor", "swiftie"],
    "Critical Role (Web Series)": ["critical role", "vox machina", "mighty nein", "exandria", "matthew mercer dm"],
    "Dream SMP": ["dream smp", "dreamwastaken", "georgenotfound", "tommyinnit", "wilbur soot", "ranboo", "tubbo"],
    "McElroy Family (Podcasts & Adventures)": ["mcelroy family", "the adventure zone", "taz balance", "my brother my brother", "mbmbam"],

    # ─────────────────────────────────────────────────────────────────
    # MUSICALS / THEATRE
    # ─────────────────────────────────────────────────────────────────
    "Hamilton - Miranda": ["hamilton musical", "alexander hamilton fic", "aaron burr", "lin-manuel miranda", "lams", "schuyler sisters"],
    "Six: The Musical": ["six the musical", "six queens", "catherine of aragon", "anne boleyn musical", "tudor queens", "house of holbein"],
    "Be More Chill - Iconis/Tracz": ["be more chill", "jeremy heere", "michael mell", "the squip", "boyf riends"],
    "Dear Evan Hansen - Pasek & Paul": ["dear evan hansen", "evan hansen", "connor murphy", "you will be found", "zoe murphy"],

    # ─────────────────────────────────────────────────────────────────
    # COMICS (separate from MCU)
    # ─────────────────────────────────────────────────────────────────
    "Batman - All Media Types": ["batman comics", "bruce wayne batman", "bat-family", "robin dick grayson", "tim drake red robin", "jason todd red hood", "damian wayne"],
    "Young Justice (Comics)": ["young justice", "robin tim drake", "kid flash bart", "superboy conner kent", "miss martian m'gann"],
    "Daredevil (Comics)": ["daredevil comics", "matt murdock", "foggy nelson", "karen page", "hell's kitchen"],
    "X-Men (Comicverse)": ["x-men comics", "professor charles xavier", "magneto erik lehnsherr", "jean grey phoenix", "scott summers cyclops", "wolverine logan"],
    "DCU (Comics)": ["dc universe comics", "justice league comics", "teen titans comics", "the flash barry", "green lantern hal", "aquaman arthur"],
}
