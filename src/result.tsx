import {
  Action,
  ActionPanel,
  clearSearchBar,
  Clipboard,
  Form,
  getPreferenceValues,
  Icon,
  List,
  LocalStorage,
  openExtensionPreferences,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { ChatGPTAPI, ChatGPTConversation } from "chatgpt";
import { useCallback, useEffect, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { defaultProfileImage } from "./profile-image";
import { ConversationItem, shareConversation } from "./share-gpt";
import { Answer, ChatAnswer } from "./type";
import say from "say";

const FullTextInput = ({ onSubmit }: { onSubmit: (text: string) => void }) => {
  const [text, setText] = useState<string>("");
  return (
    <Form
      actions={
        <ActionPanel>
          <Action
            title="Submit"
            icon={Icon.Checkmark}
            onAction={() => {
              onSubmit(text);
            }}
          />
        </ActionPanel>
      }
    >
      <Form.TextArea id="question" title="Question" placeholder="Type your question here" onChange={setText} />
    </Form>
  );
};

export default function ChatGPT() {
  const [conversationId, setConversationId] = useState<string>(uuidv4());
  const [conversation, setConversation] = useState<ChatGPTConversation>();
  const [answers, setAnswers] = useState<ChatAnswer[]>([]);
  const [savedAnswers, setSavedAnswers] = useState<Answer[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [searchText, setSearchText] = useState<string>("");
  const [selectedAnswerId, setSelectedAnswer] = useState<string | null>(null);

  const { pop, push } = useNavigation();

  useEffect(() => {
    (async () => {
      const storedSavedAnswers = await LocalStorage.getItem<string>("savedAnswers");

      if (!storedSavedAnswers) {
        setSavedAnswers([]);
      } else {
        const answers: Answer[] = JSON.parse(storedSavedAnswers);
        setSavedAnswers((previous) => [...previous, ...answers]);
      }
    })();
  }, []);

  useEffect(() => {
    LocalStorage.setItem("savedAnswers", JSON.stringify(savedAnswers));
  }, [savedAnswers]);

  useEffect(() => {
    (async () => {
      const initConversation = await chatGPT.getConversation();
      setConversation(initConversation);
    })();
  }, []);

  const handleSaveAnswer = useCallback(
    async (answer: Answer) => {
      const toast = await showToast({
        title: "Saving your answer...",
        style: Toast.Style.Animated,
      });
      answer.savedAt = new Date().toISOString();
      setSavedAnswers([...savedAnswers, answer]);
      toast.title = "Answer saved!";
      toast.style = Toast.Style.Success;
    },
    [setSavedAnswers, savedAnswers]
  );

  const [chatGPT] = useState(() => {
    const sessionToken = getPreferenceValues<{
      sessionToken: string;
    }>().sessionToken;

    return new ChatGPTAPI({ sessionToken });
  });

  async function getAnswer(question: string) {
    const toast = await showToast({
      title: "Getting your answer...",
      style: Toast.Style.Animated,
    });

    const isAuthenticated: boolean = await chatGPT.getIsAuthenticated();

    if (!isAuthenticated) {
      toast.title = "Your session token is invalid!";
      toast.style = Toast.Style.Failure;
      openExtensionPreferences();
      setIsLoading(false);
    }

    const answerId = uuidv4();
    setIsLoading(true);
    const baseAnswer: ChatAnswer = {
      id: answerId,
      answer: "",
      partialAnswer: "",
      done: false,
      question: question,
      conversationId: conversationId,
      createdAt: new Date().toISOString(),
    };

    // Add new answer
    setAnswers((prev) => {
      return [...prev, baseAnswer];
    });

    // Weird selection glitch workaround
    setTimeout(async () => {
      setSelectedAnswer(answerId);
    }, 50);

    conversation &&
      (await conversation
        .sendMessage(question, {
          timeoutMs: 2 * 60 * 1000,
          onProgress: (progress) => {
            setAnswers((prev) => {
              const newAnswers = prev.map((a) => {
                if (a.id === answerId) {
                  return {
                    ...a,
                    partialAnswer: progress,
                  };
                }
                return a;
              });
              return newAnswers;
            });
          },
        })
        .then((data) => {
          const newAnswer: ChatAnswer = {
            ...baseAnswer,
            answer: data,
            partialAnswer: data,
            done: true,
          };
          setAnswers((prev) => {
            return prev.map((a) => {
              if (a.id === answerId) {
                return newAnswer;
              }
              return a;
            });
          });
        })
        .then(() => {
          clearSearchBar();
          setIsLoading(false);
          toast.title = "Got your answer!";
          toast.style = Toast.Style.Success;
        })
        .catch((err) => {
          toast.title = "Error";
          if (err instanceof Error) {
            toast.message = err?.message;
          }
          toast.style = Toast.Style.Failure;
        }));
  }

  const getActionPanel = (answer?: ChatAnswer) => (
    <ActionPanel>
      {searchText.length > 0 ? (
        <>
          <Action
            title="Get answer"
            icon={Icon.ArrowRight}
            onAction={() => {
              getAnswer(searchText);
            }}
          />
        </>
      ) : answer && selectedAnswerId === answer.id ? (
        <>
          <Action.CopyToClipboard icon={Icon.CopyClipboard} title="Copy Answer" content={answer.answer} />
          <Action.CopyToClipboard icon={Icon.CopyClipboard} title="Copy Question" content={answer.question} />
          <Action
            icon={Icon.Star}
            title="Save Answer"
            onAction={() => handleSaveAnswer(answer)}
            shortcut={{ modifiers: ["cmd"], key: "s" }}
          />
          <Action
            icon={Icon.SpeechBubble}
            title="Speak"
            onAction={() => {
              say.stop();
              say.speak(answer.answer);
            }}
            shortcut={{ modifiers: ["cmd"], key: "p" }}
          />

          <Action.CreateSnippet
            icon={Icon.Snippets}
            title="Save as a Snippet"
            snippet={{ text: answer.answer, name: answer.question }}
            shortcut={{ modifiers: ["cmd"], key: "n" }}
          />
          <Action
            title="Share to shareg.pt"
            shortcut={{ modifiers: ["cmd", "shift"], key: "s" }}
            icon={Icon.Upload}
            onAction={async () => {
              if (answer) {
                const toast = await showToast({
                  title: "Sharing your conversation...",
                  style: Toast.Style.Animated,
                });
                await shareConversation({
                  avatarUrl: defaultProfileImage,
                  items: answers.flatMap((a): ConversationItem[] => [
                    {
                      value: a.question,
                      from: "human",
                    },
                    {
                      value: a.answer,
                      from: "gpt",
                    },
                  ]),
                })
                  .then(({ url }) => {
                    Clipboard.copy(url);
                    toast.title = `Copied link to clipboard!`;
                    toast.style = Toast.Style.Success;
                  })
                  .catch(() => {
                    toast.title = "Error while sharing conversation";
                    toast.style = Toast.Style.Failure;
                  });
              }
            }}
          />
        </>
      ) : null}
      <Action
        title="Full text input"
        shortcut={{ modifiers: ["cmd"], key: "t" }}
        icon={Icon.Text}
        onAction={() => {
          push(
            <FullTextInput
              onSubmit={(text) => {
                getAnswer(text);
                pop();
              }}
            />
          );
        }}
      />
      {answers.length > 0 && (
        <Action
          style={Action.Style.Destructive}
          title="Start new conversation"
          shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
          icon={Icon.RotateAntiClockwise}
          onAction={() => {
            setAnswers([]);
            clearSearchBar();
            setConversationId(uuidv4());
            setIsLoading(false);
          }}
        />
      )}
    </ActionPanel>
  );

  return (
    <List
      isShowingDetail={answers.length > 0 ? true : false}
      filtering={false}
      isLoading={isLoading}
      onSearchTextChange={setSearchText}
      throttle={false}
      navigationTitle={"ChatGPT"}
      actions={getActionPanel()}
      selectedItemId={selectedAnswerId || undefined}
      onSelectionChange={(id) => {
        if (id !== selectedAnswerId) {
          setSelectedAnswer(id);
        }
      }}
      searchBarPlaceholder={
        answers.length > 0 ? "Ask another question..." : isLoading ? "Generating your answer..." : "Ask a question..."
      }
    >
      {answers.length == 0 ? (
        <List.EmptyView
          title="Ask anything!"
          description={
            isLoading
              ? "Hang on tight! This might require some time. You may redo your search if it takes longer"
              : "Type your question or prompt from the search bar and hit the enter key"
          }
          icon={Icon.QuestionMark}
        />
      ) : (
        answers
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .map((answer, i) => {
            const currentAnswer = answer.done ? answer.answer : answer.partialAnswer;
            const markdown = `${currentAnswer}`;
            return (
              <List.Item
                id={answer.id}
                key={answer.id}
                accessories={[{ text: `#${answers.length - i}` }]}
                title={answer.question}
                detail={
                  <List.Item.Detail
                    markdown={markdown}
                    metadata={
                      <List.Item.Detail.Metadata>
                        <List.Item.Detail.Metadata.Label title="Question" text={answer.question} />
                        <List.Item.Detail.Metadata.Separator />
                        <List.Item.Detail.Metadata.Label
                          title="Date"
                          text={new Date(answer.createdAt).toLocaleString()}
                        />
                        <List.Item.Detail.Metadata.Separator />
                        <List.Item.Detail.Metadata.Label title="ID" text={answer.id} />
                        <List.Item.Detail.Metadata.Label title="Conversation ID" text={answer.conversationId} />
                      </List.Item.Detail.Metadata>
                    }
                  />
                }
                actions={isLoading ? undefined : getActionPanel(answer)}
              />
            );
          })
      )}
    </List>
  );
}
