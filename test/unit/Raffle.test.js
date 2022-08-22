const { assert, expect } = require("chai");
const { getNamedAccounts, deployments, ethers, network } = require("hardhat");
const { developmentChains, networkConfig } = require("../../helper-hardhat-config");

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", function () {
          let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval;
          const chainId = network.config.chainId;

          beforeEach(async function () {
              //const { deployer } = await getNamedAccounts();
              deployer = (await getNamedAccounts()).deployer;
              await deployments.fixture(["all"]);
              raffle = await ethers.getContract("Raffle", deployer);
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer);
              raffleEntranceFee = await raffle.getEntranceFee();
              interval = await raffle.getInterval();
          });

          describe("constructor", function () {
              it("initializes the raffle correctly", async function () {
                  /* yarn hardhat test --grep "initializes the raffle" */
                  //Ideally we make our tests have just 1 assert per "it"
                  const raffleState = await raffle.getRaffleState();
                  //const interval = await raffle.getInterval();
                  assert.equal(raffleState.toString(), "0");
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"]);
              });
          });

          describe("enterRaffle", function () {
              /* yarn hardhat test --grep "you don't pay enough" */
              it("reverts when you don't pay enough", async function () {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  );
              });
              it("records players when they enter", async function () {
                  /* yarn hardhat test --grep "records players when they enter" */
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  const playerFromContract = await raffle.getPlayer(0);
                  assert.equal(playerFromContract, deployer);
              });
              it("emits event on enter", async function () {
                  /* yarn hardhat test --grep "emits event on enter" */
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEnter"
                  );
              });
              it("dosen't allow entrance when raffle is calculating", async function () {
                  /* yarn hardhat test --grep "dosen't allow when raffle is calculating" */
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []); // oder => await network.provider.request({method: "evm_mine", params: []});
                  // We pretend to be a Chainlink Keeper
                  await raffle.performUpkeep([]);
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__NotOpen"
                  );
              });
              // ERROR => 15:37 => yarn add --dev @chainlink/contracts@0.4.0
          });

          describe("checkUpkeep", function () {
              it("returns false if people haven't send any ETH", async function () {
                  /* yarn hardhat test --grep "returns false if people haven't send any ETH" */
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                  assert(!upkeepNeeded);
              });
              it("returns false if raffle isn't open", async function () {
                  /* yarn hardhat test --grep "returns false if raffle isn't open" */
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.send("evm_mine", []);
                  await raffle.performUpkeep([]);
                  const raffleState = await raffle.getRaffleState();
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([]);
                  assert.equal(raffleState.toString(), "1");
                  assert.equal(upkeepNeeded, false);
              });
              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 1]);
                  await network.provider.request({ method: "evm_mine", params: [] });
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
                  assert(!upkeepNeeded);
              });
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee });
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                  await network.provider.request({ method: "evm_mine", params: [] });
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep("0x");
                  assert(upkeepNeeded);
              });
              describe("performUpkeep", function () {
                  it("it can only run if checkupkeep is true", async function () {
                      await raffle.enterRaffle({ value: raffleEntranceFee });
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                      await network.provider.send("evm_mine", []);
                      const tx = await raffle.performUpkeep([]);
                      assert(tx);
                  });
                  it("reverts when checkupkeep is false", async function () {
                      await expect(raffle.performUpkeep([])).to.be.revertedWith(
                          "Raffle__UpkeepNotNeeded"
                      );
                  });
                  it("updates the raffle state, emits and event, and calls the vrf coordinator", async function () {
                      await raffle.enterRaffle({ value: raffleEntranceFee });
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                      await network.provider.send("evm_mine", []);
                      const txResponse = await raffle.performUpkeep([]);
                      const txReceipt = await txResponse.wait(1);
                      const requestId = txReceipt.events[1].args.requestId;
                      const raffleState = await raffle.getRaffleState();
                      assert(requestId.toNumber() > 0);
                      assert(raffleState.toString() == "1");
                  });
              });
              describe("fulfillRandomWords", function () {
                  beforeEach(async function () {
                      await raffle.enterRaffle({ value: raffleEntranceFee });
                      await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]);
                      await network.provider.send("evm_mine", []);
                  });
                  it("can only be called after performUpkeep", async function () {
                      await expect(
                          vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                      ).to.be.revertedWith("nonexistent request");
                      await expect(
                          vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                      ).to.be.revertedWith("nonexistent request");
                  });
                  // TO FLA-wayyy to big
                  it("picks a winner, resets the lottery, and sends money", async function () {
                      const additionalEntrants = 3;
                      const startingAccountIndex = 1; // deployer = 0
                      const accounts = await ethers.getSigners();
                      for (
                          let i = startingAccountIndex;
                          i < startingAccountIndex + additionalEntrants;
                          i++
                      ) {
                          const accountConnectedRaffle = raffle.connect(accounts[i]);
                          await accountConnectedRaffle.enterRaffle({ value: raffleEntranceFee });
                      }
                      const startingTimeStamp = await raffle.getLatestTimeStamp();

                      //performUpkeep(mock being Chainlink Keepers)
                      //fuffillRandomWords (mock being the Chainlink VRF)
                      //We will have to wait for the fulfillRandomWords to be called
                      await new Promise(async (resolve, reject) => {
                          raffle.once("WinnerPicked", async () => {
                              console.log("Found the event!");
                              try {
                                  const recentWinner = await raffle.getRecentWinner();
                                  console.log(recentWinner);
                                  console.log(accounts[2].address);
                                  console.log(accounts[0].address);
                                  console.log(accounts[1].address);
                                  console.log(accounts[2].address);
                                  const raffleState = await raffle.getRaffleState();
                                  const endingTimeStamp = await raffle.getLatestTimeStamp();
                                  const numPlayers = await raffle.getNumberOfPlayers();
                                  const winnerEndingBalance = await accounts[1].getBalance();
                                  assert.equal(numPlayers.toString(), "0");
                                  assert.equal(raffleState.toString(), "0");
                                  assert(endingTimeStamp > startingTimeStamp);

                                  assert.equal(
                                      winnerEndingBalance.toString(),
                                      winnerStartingBalance.add(
                                          raffleEntranceFee
                                              .mul(additionalEntrants)
                                              .add(raffleEntranceFee)
                                              .toString()
                                      )
                                  );
                              } catch (e) {
                                  reject(e);
                              }
                              resolve();
                          });
                          //Setting up the listener
                          //below, we will fire the event, and the listener will pick it up, and resolve
                          const tx = await raffle.performUpkeep([]);
                          const txReceipt = await tx.wait(1);
                          const winnerStartingBalance = await accounts[1].getBalance();
                          await vrfCoordinatorV2Mock.fulfillRandomWords(
                              txReceipt.events[1].args.requestId,
                              raffle.address
                          );
                      });
                  });
              });
          });
      });
//time16:05:06
