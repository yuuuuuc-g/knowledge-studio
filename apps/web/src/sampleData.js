export const initialBooks = [
  {
    id: "classics-1",
    title: "读懂中国的唯一框架：权力、财富、地位三角形",
    author: "课程讲义",
    language: "中文",
    type: "经典文本",
    tags: ["政治", "经济", "社会", "结构"],
    paragraphs: [
      "今天是第零课。我们后面会进入历史、政治、经济、社会这些内容。但如果一开始就让大家背定义，什么叫政治学、什么叫经济学、什么叫社会学，这样学起来很慢，也很容易散。",
      "我更希望大家先有一个对象，然后通过这个对象把框架搭起来。这个对象就是中国。",
      "为什么选中国？原因很简单：这是大家最熟悉、最有体感、也最容易被各种叙事包住的对象。你对它有经验，有情绪，有生活里的例子，也有很多似懂非懂的判断。我们正好拿它来做一次解剖。",
      "后面讲历史，讲政治制度，讲经济改革，讲社会结构，都会回到这个框架里。你只要先把这个框架抓住，后面很多复杂材料就不会乱。",
      "三个学科，本质上都在研究一个问题：稀缺资源如何分配。政治关心权力如何分配，经济关心财富如何分配，社会关心地位如何分配。"
    ]
  },
  {
    id: "english-1",
    title: "Walden: A Life By Design",
    author: "Henry David Thoreau",
    language: "English",
    type: "外语语料",
    tags: ["classic", "nature", "self-education"],
    paragraphs: [
      "I went to the woods because I wished to live deliberately, to front only the essential facts of life.",
      "Thoreau's sentence is not merely about retreating into nature. It asks whether a person can design a life in which attention, labor, reading, and reflection are deliberately arranged.",
      "For a student, the useful question is not whether everyone should live in a cabin. The sharper question is what counts as an essential fact of student life, and what distractions prevent that fact from being faced."
    ]
  }
];

export function createDefaultMap(book) {
  return {
    id: `map-${book.id}`,
    title: `${book.title} 结构图`,
    sourceBookId: book.id,
    scene: null,
    structure: {
      title: `${book.title} 结构图`,
      nodes: [
        { text: "稀缺资源如何分配", kind: "question", x: 180, y: 330 },
        { text: "权力如何分配", kind: "concept", x: 620, y: 230 },
        { text: "财富如何分配", kind: "concept", x: 640, y: 360 },
        { text: "地位如何分配", kind: "concept", x: 620, y: 500 },
        { text: "不要背定义，先抓框架", kind: "evidence", x: 220, y: 60 }
      ],
      edges: [
        [0, 1],
        [0, 2],
        [0, 3],
        [4, 0]
      ]
    }
  };
}
