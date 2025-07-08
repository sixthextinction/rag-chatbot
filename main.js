// disable SSL certificate validation for proxy connections
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const {
  initializeRAG,
  askQuestion,
  getKnowledgeStats,
  forgetTopic,
  listKnownTopics
} = require('./rag');
const config = require('./config');

// create readline interface for interactive CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '❓ Ask a technical question: '
});

// global variable to store RAG context
let ragContext = null;

// display welcome message
function showWelcome() {
  console.log('\n🎉 Welcome to the Tech Explainer Chatbot! 🎉');
  console.log('═════════════════════════════════════════════════');
  console.log('I can provide a technical brief on any topic.');
  console.log('I fetch fresh information from the web and generate a comprehensive overview.');
  console.log('');
  console.log('💡 Try asking me about:');
  console.log('   • "What is Apple Intelligence and how does it work?"');
  console.log('   • "A technical overview of how electric cars work"');
  console.log('   • "Explain quantum computing to a junior engineer"');
  console.log('   • "How does the internet work, from first principles?"');
  console.log('   • Or anything else you\'re curious about!');
  console.log('');
  console.log('🎯 Special commands:');
  console.log('   • /stats - see what I know');
  console.log('   • /topics - list topics I\'ve learned');
  console.log('   • /forget <topic> - make me forget something');
  console.log('   • /help - show this help');
  console.log('   • /quit - goodbye!');
  console.log('');
  console.log('Let\'s start learning! 🚀\n');
}

// display help message
function showHelp() {
  console.log('\n📚 Tech Explainer Chatbot Help');
  console.log('═════════════════════════════════');
  console.log('🤔 Just ask me a technical question! I\'ll:');
  console.log('   1. Search the web for fresh, relevant information');
  console.log('   2. Analyze the context from multiple sources');
  console.log('   3. Generate a structured technical brief for a beginner-level engineer');
  console.log('');
  console.log('💬 Example questions:');
  console.log('   • "What is the architecture of a modern CPU?"');
  console.log('   • "How do LLMs work?"');
  console.log('   • "What are the pros and cons of microservices?"');
  console.log('   • "Explain the SOLID principles with examples"');
  console.log('');
  console.log('⚡ Special commands:');
  console.log('   • /stats - show knowledge statistics');
  console.log('   • /topics - list all topics I know');
  console.log('   • /forget cats - forget about cats');
  console.log('   • /help - show this help');
  console.log('   • /quit - exit the chatbot');
  console.log('');
}

// helper function to save brief to a file
async function saveBriefToFile(topic, content) {
  try {
    const dataDir = path.join(__dirname, 'data');
    await fs.mkdir(dataDir, { recursive: true });
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const topicSlug = topic.replace(/\s+/g, '_').toLowerCase();
    const filename = `${timestamp}_${topicSlug}_brief.md`;
    const filePath = path.join(dataDir, filename);
    
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`💾 Brief saved to: ${path.relative(process.cwd(), filePath)}`);
    
  } catch (error) {
    console.error('❌ failed to save brief:', error.message);
  }
}

// handle special commands
async function handleCommand(input) {
  const command = input.toLowerCase().trim();
  
  if (command === '/help') {
    showHelp();
    return true;
  }
  
  if (command === '/quit' || command === '/exit') {
    console.log('\n👋 Thanks for chatting! Keep being curious! 🌟');
    process.exit(0);
  }
  
  if (command === '/stats') {
    try {
      console.log('\n📊 Knowledge Statistics');
      console.log('════════════════════════');
      
      const stats = await getKnowledgeStats(ragContext);
      
      console.log(`🧠 Topics I know about: ${stats.knowledge_base.total_topics}`);
      console.log(`📚 Total information chunks: ${stats.knowledge_base.total_chunks}`);
      console.log(`🤖 Generation model: ${stats.models.generation_model.name}`);
      console.log(`🔮 Embedding model: ${stats.models.embedding_model.name}`);
      console.log(`⚙️ Max search results: ${stats.configuration.max_search_results}`);
      console.log(`💾 Cache expires after: ${stats.configuration.cache_expiry_days} days`);
      
      if (stats.knowledge_base.recent_topics.length > 0) {
        console.log(`\n🕒 Recent topics: ${stats.knowledge_base.recent_topics.slice(-3).join(', ')}`);
      }
      
    } catch (error) {
      console.log('❌ couldn\'t get stats:', error.message);
    }
    return true;
  }
  
  if (command === '/topics') {
    try {
      console.log('\n📋 Topics I Know About');
      console.log('═══════════════════════');
      
      const topics = await listKnownTopics(ragContext);
      
      if (topics.length === 0) {
        console.log('I haven\'t learned about any topics yet! Ask me something to get started.');
      } else {
        topics.forEach((topic, i) => {
          console.log(`   ${i + 1}. ${topic}`);
        });
      }
      
    } catch (error) {
      console.log('❌ couldn\'t list topics:', error.message);
    }
    return true;
  }
  
  if (command.startsWith('/forget ')) {
    const topic = command.replace('/forget ', '').trim();
    if (!topic) {
      console.log('💭 Usage: /forget <topic name>');
      return true;
    }
    
    try {
      await forgetTopic(ragContext, topic);
      console.log(`🧠💨 Okay, I forgot about "${topic}"`);
    } catch (error) {
      console.log(`❌ couldn't forget "${topic}":`, error.message);
    }
    return true;
  }
  
  return false; // not a command
}

// handle user questions
async function handleQuestion(question) {
  try {
    console.log('\n🔍 Compiling technical brief...');
    
    const result = await askQuestion(ragContext, question);
    
    console.log('\n📝 Technical Brief:');
    console.log('══════════════════════');
    console.log(result.answer);
    
    // save brief to file
    await saveBriefToFile(result.topic, result.answer);
    
    if (result.sources.length > 0) {
      console.log('\n📚 Sources I used:');
      result.sources.forEach((source, i) => {
        console.log(`   ${i + 1}. ${source.title || source.name}`);
        if (source.url) {
          console.log(`      ${source.url}`);
        }
      });
    }
    
    console.log(`\n💡 Confidence: ${result.confidence}% | Topic: ${result.topic}`);
    
    if (result.learned_new) {
      console.log('🎉 I learned something new about this topic!');
    }
    
  } catch (error) {
    console.log('❌ oops, something went wrong:', error.message);
    
    // provide helpful error messages
    if (error.message.includes('BRIGHT_DATA')) {
      console.log('\n💡 To fix this:');
      console.log('   1. Copy env.example to .env');
      console.log('   2. Add your Bright Data credentials');
      console.log('   3. Sign up at https://brightdata.com if needed');
    }
    
    if (error.message.includes('ollama') || error.message.includes('models')) {
      console.log('\n💡 To fix this:');
      console.log('   1. Make sure Ollama is running: ollama serve');
      console.log('   2. Download models: ollama pull gemma3:1b');
      console.log('   3. Download embeddings: ollama pull nomic-embed-text:latest');
    }
  }
}

// main interactive loop
function startChatbot() {
  showWelcome();
  
  rl.on('line', async (input) => {
    const trimmedInput = input.trim();
    
    if (!trimmedInput) {
      rl.prompt();
      return;
    }
    
    // check if it's a command
    if (trimmedInput.startsWith('/')) {
      await handleCommand(trimmedInput);
    } else {
      // it's a question
      await handleQuestion(trimmedInput);
    }
    
    console.log('\n' + '─'.repeat(50));
    rl.prompt();
  });
  
  rl.on('close', () => {
    console.log('\n👋 Thanks for chatting! Keep being curious! 🌟');
    process.exit(0);
  });
  
  // start the conversation
  rl.prompt();
}

// demonstration function for Apple Intelligence
async function demonstrateAppleIntelligence() {
  console.log('🎯 Tech Explainer Demo - Apple Intelligence');
  console.log('══════════════════════════════════════════════════');

  try {
    // initialize the RAG pipeline
    ragContext = await initializeRAG(config);

    // ask the requested question
    const question = "What is Apple Intelligence and how does it work?";
    console.log(`\n❓ Demo question: ${question}`);
    
    const result = await askQuestion(ragContext, question);
    
    console.log('\n📝 Technical Brief:');
    console.log('══════════════════════');
    console.log(result.answer);
    
    // save that answer to file
    // await saveBriefToFile(result.topic, result.answer);
    
    if (result.sources.length > 0) {
      console.log('\n📚 Sources used:');
      result.sources.forEach((source, i) => {
        console.log(`   ${i + 1}. ${source.title || source.name}`);
        if (source.url) {
          console.log(`      ${source.url}`);
        }
      });
    }
    
    console.log(`\n💡 Confidence: ${result.confidence}% | Learned new info: ${result.learned_new ? 'Yes' : 'No'}`);
    
    console.log('\n🎉 Demo completed! Starting interactive mode...\n');
    
    // start interactive chatbot
    startChatbot();
    
  } catch (error) {
    console.error('❌ demo failed:', error.message);
    
    if (error.message.includes('missing required models')) {
      console.log('\n💡 To fix this, run:');
      console.log('   ollama pull gemma3:1b');
      console.log('   ollama pull nomic-embed-text:latest');
    }

    if (error.message.includes('Ollama connection failed')) {
      console.log('\n💡 To fix this, run:');
      console.log('   ollama serve');
    }

    if (error.message.includes('BRIGHT_DATA')) {
      console.log('\n💡 To fix this:');
      console.log('   1. Copy env.example to .env');
      console.log('   2. Add your Bright Data credentials:');
      console.log('      BRIGHT_DATA_CUSTOMER_ID=your_customer_id');
      console.log('      BRIGHT_DATA_ZONE=your_zone');
      console.log('      BRIGHT_DATA_PASSWORD=your_password');
    }

    process.exit(1);
  }
}

async function main() {
  // check for 'demo' argument
  const args = process.argv.slice(2);
  const isDemo = args.includes('demo');

  if (isDemo) {
    await demonstrateAppleIntelligence();
  } else {
    // initialize the RAG pipeline
    ragContext = await initializeRAG(config);
    startChatbot();
  }
}

main().catch(error => {
  console.error('\n💥 unhandled error in main:', error.message);
  process.exit(1);
}); 