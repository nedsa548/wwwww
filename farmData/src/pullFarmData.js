const ABI = require("../abis/pangolinABI.json");
const pangolinContractABI = require("../abis/pangolinContractABI.json");
const ADDRESSES = require("./addresses.json");
const Web3 = require("web3");
const web3 = new Web3(new Web3.providers.HttpProvider("https://api.avax.network/ext/bc/C/rpc"));
const helpers = require("./helpers.js");
const axios = require("axios");
const { parse } = require("path");

const chunkSize = 10;

async function pullWeeklyFarmData() {

    let totalAllocPoints = 0;
    const farmArray = [];
    const miniChefContract = new web3.eth.Contract(ABI.MINICHEF_V2, ADDRESSES.PANGOLIN_MINICHEF_V2_ADDRESS);

    const [ lpTokens, poolInfos ] = await Promise.all([
        miniChefContract.methods.lpTokens().call(),
        miniChefContract.methods.poolInfos().call(),
    ]);

    //console.log([ lpTokens, poolInfos ]);

    let lookupDatas = lpTokens.map((pgl, pid) => [pid, pgl]);
    while (lookupDatas.length) {
        await Promise.all( lookupDatas.splice(0, chunkSize).map(data => lookup(...data)));
    }
    farmArray.sort((a,b) => a.pid > b.pid ? 1 : -1);

    console.dir(farmArray, {'maxArrayLength': null});

    async function lookup(pid, pgl) {
        const pglContract = new web3.eth.Contract(ABI.PAIR, pgl);
        const [token0Symbol, token1Symbol, rewarder] = await Promise.all([
            pglContract.methods.token0().call().then(helpers.getSymbolCached),
            pglContract.methods.token1().call().then(helpers.getSymbolCached),
            miniChefContract.methods.rewarder(pid).call(),
        ]);
        const pangolinData = { data: { data: { pairDayDatas } } } = await axios({
            url: "https://api.thegraph.com/subgraphs/name/pangolindex/exchange",
            method: "post",
            data: {
                query: `query {
                    pairDayDatas(
                        where: {
                            pairAddress: "${pgl.toLowerCase()}"
                        }
                        orderBy: date
                        orderDirection: desc
                        first: 8
                    ) {
                        date
                        reserveUSD
                        dailyVolumeUSD
                        dailyTxns
                        token0 {
                            id
                        }
                        token1 {
                            id
                        }
                    }
                }`
            }
        });

        var farmWeight = parseInt(poolInfos[pid].allocPoint);

        if ( farmWeight > 0) {
            var weeklyVol = 0;
            var TVL = 0;
            var txCount = 0;
            var count = 0;
            for (const x of pairDayDatas.slice(1)) { 
                count += 1;
                weeklyVol += parseFloat(x.dailyVolumeUSD);
                txCount += parseFloat(x.dailyTxns);
                if (count == 1) {
                    TVL = parseFloat(x.reserveUSD);
                }
            }

            const APR = await axios.get(`https://api.pangolin.exchange/pangolin/apr2/${pid}`).then(res => {
                return res.data;
            });
            
            const token0 = pangolinData.data.data.pairDayDatas[0]["token0"]["id"];
            const token1 = pangolinData.data.data.pairDayDatas[0]["token1"]["id"];

            const pangolinContract = new web3.eth.Contract(pangolinContractABI, pgl.toLowerCase());
            const farmSupply = await pangolinContract.methods.balanceOf(ADDRESSES.PANGOLIN_MINICHEF_V2_ADDRESS).call();
            const poolSupply = await pangolinContract.methods.totalSupply().call();

            farmArray.push({
                "Token Pair": token0Symbol+"-"+token1Symbol,
                "pid": pid,
                "pgl": pgl.toLowerCase(),
                "rewarder": rewarder,
                "Farm Weight": farmWeight,
                "Farm Apr": APR.stakingApr,
                "Swap Fee Apr": APR.swapFeeApr,
                "Total Apr": APR.combinedApr,
                "Daily Vol(7d avg)": Math.round(weeklyVol/7),
                "Farm TVL": Math.round(TVL*farmSupply/poolSupply),
                "Pool TVL": Math.round(TVL),
                "Daily Tx Count(7d avg)": Math.round(txCount/7),
                "Average Trade Size": Math.round(weeklyVol/txCount),

            });
        }

    }
}

pullWeeklyFarmData();