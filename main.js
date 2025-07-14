const readline = require('readline');
const CONFIG = require('./config');
const { OllamaClient } = require('./ollama');
const { initializeVectorStore, storeTopicChunks, listTopics, getTopicStats, topicExists } = require('./vectorstore');
const { researchTopic } = require('./search');
const { createRAGState, setTopic, answerQuestion, clearHistory } = require('./rag');
const { generateTopicId, validateTopic } = require('./utils');
const { clearExpiredCache } = require('./cache');

// chatbot state variables
let config = CONFIG;
let ollama = null;
let vectorContext = null;
let ragState = null;
let rl = null;
let currentPhase = 'TOPIC_INGESTION'; // or 'CHAT'
let currentTopic = null;

// initialize the chatbot system
async function initialize() {
  console.log(`${'='.repeat(80)}`);
  console.log('                         INITIALIZING RAG CHATBOT');
  console.log(`${'='.repeat(80)}\n`);

  try {
    // clear expired cache files (if older than expiryDays threshold)
    clearExpiredCache(config.cache.dir, config.cache.expiryDays);

    // initialize Ollama client
    console.log('┌─ Checking Ollama connection...');
    ollama = new OllamaClient(config);
    const ollamaStatus = await ollama.checkConnection();

    if (!ollamaStatus.connected) {
      throw new Error(`Ollama not connected: ${ollamaStatus.error}`);
    }

    if (ollamaStatus.missingModels.length > 0) {
      console.log(`├─ Missing models: ${ollamaStatus.missingModels.join(', ')}`);
      console.log('├─ Attempting to pull missing models...');

      for (const model of ollamaStatus.missingModels) {
        await ollama.pullModel(model); // just a QOL thing; you can exit and manually pull if you want
      }
    }

    console.log('└─ ✅ Ollama connected successfully\n');

    // initialize vector store
    console.log('┌─ Initializing vector store...');
    vectorContext = await initializeVectorStore(config, ollama);
    console.log('└─ ✅ Vector store initialized\n');

    // initialize RAG state
    console.log('┌─ Initializing RAG state...');
    ragState = createRAGState();
    console.log('└─ ✅ RAG state initialized');

    // setup readline interface
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return true;

  } catch (error) {
    console.error('❌ initialization failed:', error.message);
    throw error;
  }
}

// start the chatbot
async function start() {
  try {
    await initialize();
    await showWelcomeMessage();
    await interactionLoop();
  } catch (error) {
    console.error('❌ chatbot failed to start:', error.message);
    process.exit(1);
  }
}

// show welcome message and available topics
async function showWelcomeMessage() {
  console.log(`${'═'.repeat(80)}`);
  console.log('                      RAG CHATBOT - TOPIC RESEARCH & Q&A');
  console.log(`${'═'.repeat(80)}`);
  console.log();

  // show known topics (if any)
  const availableTopics = await listTopics(vectorContext);
  if (availableTopics.length > 0) {
    console.log(`┌${'─'.repeat(78)}┐`);
    console.log('│                            KNOWLEDGE BASE                                │');
    console.log(`├${'─'.repeat(78)}┤`);
    for (const topic of availableTopics) {
      const stats = await getTopicStats(vectorContext, topic);
      const displayText = `${topic} (${stats.total_chunks} chunks)`;
      const padding = 76 - displayText.length;
      console.log(`│ • ${displayText}${' '.repeat(Math.max(0, padding))} │`);
    }
    console.log(`└${'─'.repeat(78)}┘`);
    console.log();
    console.log('You can research a new topic or ask questions about existing ones');
  } else {
    console.log(`┌${'─'.repeat(78)}┐`);
    console.log('│                          KNOWLEDGE BASE EMPTY                           │');
    console.log(`└${'─'.repeat(78)}┘`);
    console.log();
    console.log('Enter a topic name to start researching');
  }

  console.log();
  console.log(`┌${'─'.repeat(78)}┐`);
  console.log('│                               COMMANDS                                   │');
  console.log(`├${'─'.repeat(78)}┤`);
  console.log('│ • Enter a topic : Research and learn about a topic                      │');
  console.log('│ • "list": Show all available topics                                     │');
  console.log('│ • "stats <topic>": Show statistics for a topic                          │');
  console.log('│ • "switch <topic>": Switch to Q&A mode for an existing topic            │');
  console.log('│ • "clear": Clear conversation history                                   │');
  console.log('│ • "quit" or "exit": Exit the chatbot                                    │');
  console.log(`└${'─'.repeat(78)}┘`);
  console.log();
}

// main interaction loop
async function interactionLoop() {
  while (true) {
    try {
      const input = await getUserInput();
      const trimmedInput = input.trim();

      if (!trimmedInput) {
        continue;
      }

      // handle exit commands
      if (['quit', 'exit', 'bye'].includes(trimmedInput.toLowerCase())) {
        console.log(`\n${'═'.repeat(80)}`);
        console.log('                                GOODBYE!');
        console.log('                    Thank you for using RAG Chatbot v2!');
        console.log(`${'═'.repeat(80)}\n`);
        break;
      }

      // handle special commands (list, stats, switch, clear, back)
      if (await handleSpecialCommands(trimmedInput)) {
        continue;
      }

      // handle based on current phase
      if (currentPhase === 'TOPIC_INGESTION') {
        await handleTopicIngestion(trimmedInput);
      } else if (currentPhase === 'CHAT') {
        await handleChatQuestion(trimmedInput);
      }

    } catch (error) {
      console.log(`\n┌${'─'.repeat(78)}┐`);
      console.log('│                                ❌ ERROR                                 │');
      console.log(`├${'─'.repeat(78)}┤`);
      const errorMsg = error.message;
      const padding = 76 - errorMsg.length;
      console.log(`│ ${errorMsg}${' '.repeat(Math.max(0, padding))} │`);
      console.log(`└${'─'.repeat(78)}┘`);
      console.log('Please try again or type "quit" to exit\n');
    }
  }

  cleanup();
}

// research/topic ingestion phase
// basically: 
// 1. check if user-given topic exists in the vector db
// 2. if it does, we switch to chat/q&a mode and ask the user questions about the topic
// 3. if it doesn't, research mode. We go fetch info about user-given topic from the web, chunk it up, and stuff it in the vector db. And THEN switch to chat mode.
// 4. we repeat this process for each topic the user wants to research
async function handleTopicIngestion(input) {
  if (!validateTopic(input)) {
    console.log(`\n┌${'─'.repeat(78)}┐`);
    console.log('│                            ❌ INVALID TOPIC                             │');
    console.log(`├${'─'.repeat(78)}┤`);
    console.log('│ Please enter a valid topic name (1-100 characters)                      │');
    console.log(`└${'─'.repeat(78)}┘\n`);
    return;
  }

  const topicId = generateTopicId(input);

  // check if topic already exists
  const exists = await topicExists(vectorContext, topicId);
  if (exists) {
    console.log(`\n┌${'─'.repeat(78)}┐`);
    console.log('│                          TOPIC FOUND!                                 │');
    console.log(`├${'─'.repeat(78)}┤`);
    const topicMsg = `Topic "${input}" already exists in knowledge base`;
    const padding = 76 - topicMsg.length;
    console.log(`│ ${topicMsg}${' '.repeat(Math.max(0, padding))} │`);
    console.log(`└${'─'.repeat(78)}┘`);
    console.log('Switching to Q&A mode...\n');
    await switchToChat(topicId, input);
    return;
  }

  console.log(`\n${'═'.repeat(80)}`);
  console.log(`                        RESEARCHING TOPIC: "${input.toUpperCase()}"`);
  console.log(`${'═'.repeat(80)}`);
  console.log('This may take a few minutes...\n');

  try {
    // research the topic
    const researchData = await researchTopic(input, config);

    if (researchData.chunks.length === 0) {
      console.log(`┌${'─'.repeat(78)}┐`);
      console.log('│                            ❌ NO DATA FOUND                             │');
      console.log(`├${'─'.repeat(78)}┤`);
      console.log('│ No data found for this topic. Please try a different topic.             │');
      console.log(`└${'─'.repeat(78)}┘\n`);
      return;
    }

    // store in vector database
    console.log('┌─ Storing knowledge in vector database...');
    await storeTopicChunks(vectorContext, topicId, researchData.chunks);

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`                          ✅ RESEARCH COMPLETE FOR "${input.toUpperCase()}"`);
    console.log(`${'═'.repeat(80)}`);
    console.log(`Collected ${researchData.chunks.length} chunks from ${researchData.metadata.sources.length} sources`);

    // small delay to ensure collection is fully available
    console.log('Ensuring database consistency...');
    await new Promise(resolve => setTimeout(resolve, 1000));

    // switch to chat mode
    console.log('Switching to Q&A mode...\n');
    await switchToChat(topicId, input);

  } catch (error) {
    console.log(`\n┌${'─'.repeat(78)}┐`);
    console.log('│                           ❌ RESEARCH FAILED                            │');
    console.log(`├${'─'.repeat(78)}┤`);
    const errorMsg = error.message;
    const padding = 76 - errorMsg.length;
    console.log(`│ ${errorMsg}${' '.repeat(Math.max(0, padding))} │`);
    console.log(`└${'─'.repeat(78)}┘`);
    console.log('Please try a different topic or check your configuration\n');
  }
}

// chat phase
// basically: 
// 1. the user asks a question
// 2. we answer the question using the information in the vector db
// 3. we repeat this process for each question the user asks
async function handleChatQuestion(question) {
  try {
    console.log(`\n┌${'─'.repeat(78)}┐`);
    console.log('│                              THINKING...                                │');
    console.log(`└${'─'.repeat(78)}┘\n`);

    const response = await answerQuestion(ragState, vectorContext, ollama, config, question);

    console.log(`${'═'.repeat(80)}`);
    console.log('                                  ANSWER');
    console.log(`${'═'.repeat(80)}`);
    console.log(response.answer);
    console.log();

    if (response.sources.length > 0) {
      console.log(`┌${'─'.repeat(78)}┐`);
      console.log('│                                SOURCES                                  │');
      console.log(`├${'─'.repeat(78)}┤`);
      response.sources.forEach(source => {
        const padding = 74 - source.length;
        console.log(`│ • ${source}${' '.repeat(Math.max(0, padding))} │`);
      });
      console.log(`└${'─'.repeat(78)}┘`);
      console.log();
    }

  } catch (error) {
    console.log(`\n┌${'─'.repeat(78)}┐`);
    console.log('│                        ❌ FAILED TO ANSWER QUESTION                     │');
    console.log(`├${'─'.repeat(78)}┤`);
    const errorMsg = error.message;
    const padding = 76 - errorMsg.length;
    console.log(`│ ${errorMsg}${' '.repeat(Math.max(0, padding))} │`);
    console.log(`└${'─'.repeat(78)}┘`);
    console.log('Please try rephrasing your question\n');
  }
}

// changes the current phase to 'CHAT' (Q&A mode) and sets the current topic
async function switchToChat(topicId, topicName) {
  try {
    console.log(`┌─ Verifying topic exists: ${topicId}`);
    await setTopic(ragState, vectorContext, topicId);
    currentPhase = 'CHAT';
    currentTopic = topicName;

    console.log(`\n${'═'.repeat(80)}`);
    console.log(`                      Q&A MODE FOR: ${topicName.toUpperCase()}`);
    console.log(`${'═'.repeat(80)}`);
    console.log('Ask me anything about this topic!');
    console.log('Type "back" to return to topic selection\n');

  } catch (error) {
    console.log(`\n┌${'─'.repeat(78)}┐`);
    console.log('│                      ❌ FAILED TO SWITCH TO CHAT MODE                   │');
    console.log(`├${'─'.repeat(78)}┤`);
    const errorMsg = error.message;
    const padding = 76 - errorMsg.length;
    console.log(`│ ${errorMsg}${' '.repeat(Math.max(0, padding))} │`);
    console.log(`└${'─'.repeat(78)}┘`);
    console.log(`Debug: Attempted to switch to topic ID: "${topicId}"`);

    // try to list available topics for debugging
    try {
      const availableTopics = await listTopics(vectorContext);
      console.log(`Debug: Available topics: [${availableTopics.join(', ')}]\n`);
    } catch (listError) {
      console.log('Debug: Failed to list topics for debugging\n');
    }
  }
}

// handle special commands (list, stats, switch, clear, back)
async function handleSpecialCommands(input) {
  const [command, ...args] = input.toLowerCase().split(' ');

  switch (command) {
    case 'list':
      await showAvailableTopics();
      return true;

    case 'stats':
      if (args.length > 0) {
        await showTopicStats(args.join(' '));
      } else {
        console.log('❌ usage: stats <topic_name>\n');
      }
      return true;

    case 'switch':
      if (args.length > 0) {
        await switchToExistingTopic(args.join(' '));
      } else {
        console.log('❌ usage: switch <topic_name>\n');
      }
      return true;

    case 'clear':
      if (ragState) {
        clearHistory(ragState);
        console.log('✅ conversation history cleared\n');
      }
      return true;

    case 'back':
      if (currentPhase === 'CHAT') {
        currentPhase = 'TOPIC_INGESTION';
        currentTopic = null;
        console.log(`\n┌${'─'.repeat(78)}┐`);
        console.log('│                        TOPIC SELECTION MODE                             │');
        console.log(`└${'─'.repeat(78)}┘\n`);
      }
      return true;

    default:
      return false;
  }
}

// show all topics the chatbot knows about (i.e. are in the vector db)
async function showAvailableTopics() {
  try {
    const topics = await listTopics(vectorContext);

    if (topics.length === 0) {
      console.log('No topics available yet.\n');
      return;
    }

    console.log('Available topics:');
    for (const topic of topics) {
      const stats = await getTopicStats(vectorContext, topic);
      console.log(`  • ${topic} (${stats.total_chunks} chunks, ${Object.keys(stats.sources).length} sources)`);
    }
    console.log();

  } catch (error) {
    console.error('❌ failed to list topics:', error.message);
  }
}

// DEBUG: show statistics for a topic (i.e. how many chunks, sources, etc.)
async function showTopicStats(topicName) {
  try {
    const topicId = generateTopicId(topicName);
    const exists = await topicExists(vectorContext, topicId);

    if (!exists) {
      console.log(`❌ topic "${topicName}" not found\n`);
      return;
    }

    const stats = await getTopicStats(vectorContext, topicId);

    console.log(`Statistics for "${topicName}":`);
    console.log(`  • total chunks: ${stats.total_chunks}`);
    console.log(`  • sources: ${Object.keys(stats.sources).length}`);
    console.log(`  • chunk types: ${Object.keys(stats.chunk_types).join(', ')}`);
    console.log(`  • search types: ${Object.keys(stats.search_types).join(', ')}`);
    console.log();

  } catch (error) {
    console.error('❌ failed to get topic stats:', error.message);
  }
}

// switch to an existing (i.e. the chatbot already knows about) topic
async function switchToExistingTopic(topicName) {
  try {
    const topicId = generateTopicId(topicName);
    const exists = await topicExists(vectorContext, topicId);

    if (!exists) {
      console.log(`❌ topic "${topicName}" not found. available topics:`);
      await showAvailableTopics();
      return;
    }

    await switchToChat(topicId, topicName);

  } catch (error) {
    console.error('❌ failed to switch topic:', error.message);
  }
}

// read user input
function getUserInput() {
  const prompt = currentPhase === 'CHAT'
    ? `\n[${currentTopic}] Your question: `
    : '\nEnter topic to research (or command): ';

  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

// cleanup resources
function cleanup() {
  if (rl) {
    rl.close();
  }
  console.log('[CLEANED UP RESOURCES]');
}

// start the chatbot if this file is run directly
if (require.main === module) {
  // handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n${'═'.repeat(80)}`);
    console.log('                           SHUTTING DOWN GRACEFULLY');
    console.log(`${'═'.repeat(80)}`);
    cleanup();
    process.exit(0);
  });

  // start the chatbot
  start().catch(error => {
    console.error('❌ chatbot crashed:', error.message);
    process.exit(1);
  });
}

module.exports = {
  start,
  initialize,
  handleTopicIngestion,
  handleChatQuestion,
  switchToChat,
  cleanup
}; 